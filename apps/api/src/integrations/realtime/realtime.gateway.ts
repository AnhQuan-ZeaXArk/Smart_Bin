import { Server } from 'socket.io';
import type { Server as NodeHttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { DeviceType } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { CANONICAL_DEVICE_ID, normalizeDeviceId } from '../../config/device-id.config.js';
import { realDeviceService } from '../../demo/real-device.service.js';
import { deviceHealthService } from '../../services/device-health.service.js';
import {
  REALTIME_EVENTS,
  type DeviceStatusPayload,
  type RealtimeAlertPayload,
  type RealtimeTelemetryPayload
} from './realtime.contract.js';

export * from './realtime.contract.js';
export type TelemetryEvent = RealtimeTelemetryPayload;

const tokenSchema = z.object({ sub: z.string().min(1) });

const deviceTelemetryInputSchema = z.object({
  deviceId: z.string().min(1).default(CANONICAL_DEVICE_ID),
  deviceName: z.string().optional(),
  deviceType: z.string().optional(),
  status: z.string().optional().default('ONLINE'),
  uptimeSeconds: z.coerce.number().nonnegative(),
  cpuTempC: z.coerce.number().optional().nullable(),
  firmwareVersion: z.string().optional().nullable(),
  ipAddress: z.string().optional().nullable(),
  sentAt: z.string().optional(),
  sensors: z.object({
    distanceCm: z.coerce.number().optional().nullable(),
    fillLevel: z.coerce.number().optional().nullable()
  }).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable()
});

const deviceCommandAckInputSchema = z.object({
  commandId: z.string().min(1),
  deviceId: z.string().min(1).default(CANONICAL_DEVICE_ID),
  action: z.string().min(1),
  status: z.enum(['RECEIVED', 'COMPLETED', 'FAILED']),
  message: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional().nullable(),
  error: z.string().optional().nullable(),
  executedAt: z.string().optional()
});

export class RealtimeGateway {
  readonly io: Server;

  constructor(httpServer: NodeHttpServer) {
    const allowedOrigins = new Set(env.CORS_ORIGINS.map((o) => o.replace(/\/+$/, '')));

    this.io = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);
          const cleanOrigin = origin.trim().replace(/\/+$/, '');
          if (
            allowedOrigins.has(cleanOrigin) ||
            cleanOrigin.endsWith('.onrender.com') ||
            cleanOrigin.includes('localhost') ||
            cleanOrigin.includes('127.0.0.1')
          ) {
            return callback(null, true);
          }
          return callback(null, false);
        },
        credentials: true
      }
    });

    this.io.use(async (socket, next) => {
      const auth = socket.handshake.auth || {};

      // 1. Phân luồng xác thực dành riêng cho Thiết bị phần cứng (Raspberry Pi 5)
      if (auth.type === 'device' || auth.clientType === 'device') {
        const configuredToken = (process.env.DEVICE_INGEST_TOKEN || env.DEVICE_INGEST_TOKEN || '').trim();
        const incomingToken = typeof auth.token === 'string' ? auth.token.trim() : '';

        if (!configuredToken) {
          return next(new Error('Device authentication failed: DEVICE_INGEST_TOKEN is not configured on server'));
        }

        if (!incomingToken || incomingToken !== configuredToken) {
          return next(new Error('Device authentication failed: Invalid or missing device token'));
        }

        const rawDeviceId = typeof auth.deviceId === 'string' && auth.deviceId.trim()
          ? auth.deviceId.trim()
          : CANONICAL_DEVICE_ID;
        const deviceId = normalizeDeviceId(rawDeviceId);

        socket.data = {
          isDevice: true,
          deviceId
        };
        return next();
      }

      // 2. Phân luồng xác thực người dùng (Web / Mobile)
      if (env.isDemoMode) {
        socket.data.userId = 'demo-operator';
        socket.data.isDevice = false;
        return next();
      }

      try {
        const token = auth.token as string | undefined;
        if (!token) return next(new Error('Authentication required'));
        const payload = tokenSchema.parse(jwt.verify(token, env.JWT_SECRET));
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user?.isActive) return next(new Error('User is inactive or not found'));
        socket.data.userId = user.id;
        socket.data.isDevice = false;
        return next();
      } catch {
        return next(new Error('Invalid or expired token'));
      }
    });

    this.io.on('connection', (socket) => {
      if (socket.data.isDevice) {
        const deviceId = socket.data.deviceId || 'raspberry-pi-5';
        void socket.join('device');
        void socket.join(`device:${deviceId}`);
        console.log(`[RealtimeGateway] Device connected via Socket.IO: ${deviceId} (rooms: device, device:${deviceId})`);

        realDeviceService.setSocketConnected(deviceId, true);
        socket.emit(REALTIME_EVENTS.CONNECTED, {
          connectedAt: new Date().toISOString(),
          role: 'device',
          deviceId
        });

        // Nhận gói tin telemetry liên tục từ Pi 5 qua Socket.IO
        socket.on(REALTIME_EVENTS.DEVICE_TELEMETRY, (payload: unknown) => {
          try {
            const parsed = deviceTelemetryInputSchema.safeParse(payload);
            if (!parsed.success) {
              const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
              console.warn(`[RealtimeGateway] Invalid device:telemetry packet from ${deviceId}: ${issues}`);
              return;
            }

            const normalizedDeviceId = normalizeDeviceId(parsed.data.deviceId);
            const normalizedData = {
              ...parsed.data,
              deviceId: normalizedDeviceId
            };

            // 1. Cập nhật RealDeviceService trong RAM và phát Socket.IO 'device:heartbeat' (0ms cho RealDeviceCard)
            realDeviceService.recordHeartbeat(normalizedData, this.io);

            // 2. Chuyển tiếp tới DeviceHealthService để xử lý heartbeat thống nhất (throttling 15s + PostgreSQL)
            void deviceHealthService.processHeartbeat({
              deviceId: normalizedDeviceId,
              deviceName: parsed.data.deviceName,
              deviceType: DeviceType.RASPBERRY_PI,
              uptimeSeconds: parsed.data.uptimeSeconds,
              cpuTempC: parsed.data.cpuTempC,
              firmwareVersion: parsed.data.firmwareVersion,
              ipAddress: parsed.data.ipAddress,
              sentAt: parsed.data.sentAt,
              sensors: parsed.data.sensors,
              metadata: parsed.data.metadata
            }).catch((err) => {
              console.error(`[RealtimeGateway] Error processing heartbeat in DeviceHealthService for ${normalizedDeviceId}:`, err);
            });
          } catch (err) {
            console.error('[RealtimeGateway] Error processing device:telemetry:', err);
          }
        });

        // Nhận phản hồi trạng thái thực thi lệnh (ACK) từ Pi 5
        socket.on(REALTIME_EVENTS.DEVICE_COMMAND_ACK, (ackPayload: unknown) => {
          try {
            const parsed = deviceCommandAckInputSchema.safeParse(ackPayload);
            if (!parsed.success) {
              const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
              console.warn(`[RealtimeGateway] Invalid device:command:ack from ${deviceId}: ${issues}`);
              return;
            }
            realDeviceService.handleCommandAck(parsed.data);
          } catch (err) {
            console.error('[RealtimeGateway] Error processing device:command:ack:', err);
          }
        });

        socket.on('disconnect', (reason) => {
          console.log(`[RealtimeGateway] Device disconnected: ${deviceId} (${reason})`);
          // Cập nhật trạng thái socket trong RAM (Rule 3.1: Không tự chuyển OFFLINE khi socket disconnect)
          realDeviceService.setSocketConnected(deviceId, false);
        });
      } else {
        // Web / Mobile client
        socket.emit(REALTIME_EVENTS.CONNECTED, {
          connectedAt: new Date().toISOString(),
          role: 'client'
        });

        socket.on('disconnect', (reason) => {
          if (reason !== 'client namespace disconnect') {
            console.log(`Socket client disconnected: ${reason}`);
          }
        });
      }
    });
  }

  emitTelemetry(event: RealtimeTelemetryPayload): void {
    this.io.emit(REALTIME_EVENTS.BIN_TELEMETRY, event);
    this.io.emit(REALTIME_EVENTS.TELEMETRY, event);
  }

  emitDeviceStatus(device: DeviceStatusPayload): void {
    const normalized = {
      ...device,
      deviceId: normalizeDeviceId(device.deviceId)
    };
    this.io.emit(REALTIME_EVENTS.DEVICE_STATUS, normalized);
  }

  emitAlert(event: RealtimeAlertPayload): void {
    this.io.emit(REALTIME_EVENTS.ALERT_CREATED, event);
    this.io.emit(REALTIME_EVENTS.ALERT, event);
  }

  emitAlertResolved(event: RealtimeAlertPayload): void {
    this.io.emit(REALTIME_EVENTS.ALERT_RESOLVED, event);
    this.io.emit(REALTIME_EVENTS.ALERT_UPDATED, event);
    this.io.emit(REALTIME_EVENTS.ALERT, event);
  }
}
