import { Server } from 'socket.io';
import type { Server as NodeHttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { DeviceType } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { CANONICAL_DEVICE_ID, normalizeDeviceId } from '../../config/device-id.config.js';
import { DEVICE_HEALTH_CONFIG } from '../../config/device-health.config.js';
import { realDeviceService } from '../../demo/real-device.service.js';
import { deviceHealthService } from '../../services/device-health.service.js';
import {
  REALTIME_EVENTS,
  type DeviceStatusPayload,
  type RealtimeAlertPayload,
  type RealtimeTelemetryPayload
} from './realtime.contract.js';
import { aiDetectionInputSchema } from './ai-detection.schema.js';
import { unifiedTelemetryIngestionService } from '../../services/unified-telemetry-ingestion.service.js';
import { collectionSessionService } from '../../services/collection-session.service.js';

export * from './realtime.contract.js';
export type TelemetryEvent = RealtimeTelemetryPayload;

const tokenSchema = z.object({ sub: z.string().min(1), exp: z.number().optional() });

const compartmentFillInputSchema = z.object({
  distanceCm: z.coerce.number().optional().nullable(),
  fillLevel: z.coerce.number().optional().nullable(),
  fillPercent: z.coerce.number().optional().nullable(),
  status: z.string().optional().default('OK'),
  updatedAt: z.string().optional().nullable()
}).transform((data) => ({
  ...data,
  fillLevel: data.fillLevel ?? data.fillPercent ?? null
}));

const deviceTelemetryInputSchema = z.object({
  deviceId: z.string().min(1).default(CANONICAL_DEVICE_ID),
  stationCode: z.string().optional().default('STATION_A'),
  deviceName: z.string().optional(),
  deviceType: z.string().optional(),
  status: z.string().optional().default('ONLINE'),
  uptimeSeconds: z.coerce.number().nonnegative().optional(),
  uptimeMs: z.coerce.number().nonnegative().optional(),
  cpuTempC: z.coerce.number().optional().nullable(),
  firmwareVersion: z.string().optional().nullable(),
  ipAddress: z.string().optional().nullable(),
  sentAt: z.string().optional(),
  clientMessageId: z.string().optional(),
  bootCount: z.union([z.bigint(), z.number(), z.string()]).optional(),
  bootId: z.string().optional(),
  sampleSeq: z.coerce.number().optional(),
  payloadHash: z.string().optional(),
  isLegacy: z.boolean().optional(),
  subsystems: z.object({
    yolo: z.string().optional(),
    camera: z.string().optional(),
    esp32: z.string().optional()
  }).optional().nullable(),
  aiDetection: aiDetectionInputSchema,
  sensors: z.object({
    distanceCm: z.coerce.number().optional().nullable(),
    fillLevel: z.coerce.number().optional().nullable(),
    fillPercent: z.coerce.number().optional().nullable(),
    organic: compartmentFillInputSchema.optional().nullable(),
    recyclable: compartmentFillInputSchema.optional().nullable(),
    nonRecyclable: compartmentFillInputSchema.optional().nullable()
  }).optional().nullable(),
  lidAlert: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().nullable()
}).transform((data) => {
  const uptimeSeconds = data.uptimeSeconds ?? (data.uptimeMs !== undefined ? Math.round(data.uptimeMs / 1000) : 0);
  return {
    ...data,
    uptimeSeconds
  };
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

/**
 * Chuẩn hóa timestamp đo lường của cảm biến để bảo đảm tính tươi (freshness)
 * và triệt tiêu sai lệch đồng hồ (clock skew) giữa Pi/ESP32 và Backend Server.
 */
export function projectSensorTimestamp(
  sentAt: string | undefined,
  sensorUpdatedAt: string | undefined | null,
  serverReceivedAt: Date = new Date()
): Date {
  const sentMs = sentAt ? new Date(sentAt).getTime() : 0;
  const sensorMs = sensorUpdatedAt ? new Date(sensorUpdatedAt).getTime() : 0;
  if (sentMs > 0 && sensorMs > 0 && Number.isFinite(sentMs) && Number.isFinite(sensorMs)) {
    const delayOnPiMs = Math.max(0, sentMs - sensorMs);
    if (delayOnPiMs > DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS) {
      return new Date(Math.max(0, serverReceivedAt.getTime() - delayOnPiMs));
    }
    return serverReceivedAt;
  }
  return serverReceivedAt;
}

/**
 * Tổng hợp kết quả ingestion của từng ngăn rác thành trạng thái ACK toàn thể.
 */
export function summarizeIngestionResults(binResults: Array<{ binCode: string; status: string }>): {
  success: boolean;
  status: string;
} {
  if (binResults.length === 0) return { success: true, status: 'COMMITTED' };
  const fatal = binResults.find((r) =>
    r.status === 'INGESTION_ERROR' ||
    r.status === 'COMMISSIONING_REQUIRED' ||
    r.status === 'SEQUENCE_CLASH_TAMPERED' ||
    r.status === 'HASH_MISMATCH' ||
    r.status === 'LATE_PACKET_EXPIRED' ||
    r.status === 'UNKNOWN_STATION' ||
    r.status === 'UNKNOWN_BIN'
  );
  if (fatal) return { success: false, status: fatal.status };
  if (binResults.some((r) => r.status === 'ACCEPTED_IN_ORDER' || r.status === 'ACCEPTED_LATE')) {
    return { success: true, status: 'COMMITTED' };
  }
  if (binResults.every((r) => r.status === 'FAST_ACK_DUPLICATE')) {
    return { success: true, status: 'FAST_ACK_DUPLICATE' };
  }
  return { success: true, status: 'COMMITTED' };
}

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

    // Middleware xác thực kết nối
    this.io.use(async (socket, next) => {
      const auth = socket.handshake.auth || {};

      // 1. Phân luồng xác thực dành riêng cho Thiết bị phần cứng (Raspberry Pi 5 Gateway)
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

      // 2. Phân luồng máy khách Web / Mobile
      if (env.isDemoMode) {
        socket.data.userId = 'demo-operator';
        socket.data.userRole = 'ADMIN';
        socket.data.isDevice = false;
        return next();
      }

      const token = typeof auth.token === 'string' ? auth.token.trim() : undefined;
      if (!token) {
        socket.data.userId = 'public-viewer';
        socket.data.userRole = 'VIEWER';
        socket.data.isDevice = false;
        return next();
      }

      try {
        const payload = tokenSchema.parse(jwt.verify(token, env.JWT_SECRET));
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          include: { role: true }
        });

        if (user?.isActive) {
          socket.data.userId = user.id;
          socket.data.userRole = user.role.name;
          socket.data.tokenExp = payload.exp ? payload.exp * 1000 : undefined;
        } else {
          socket.data.userId = 'public-viewer';
          socket.data.userRole = 'VIEWER';
        }
        socket.data.isDevice = false;
        return next();
      } catch {
        socket.data.userId = 'public-viewer';
        socket.data.userRole = 'VIEWER';
        socket.data.isDevice = false;
        return next();
      }
    });

    // Định kỳ quét kiểm tra token hết hạn (Mỗi 15s - SLA <= 3.0s sau khi phát hiện quá hạn)
    setInterval(() => {
      const now = Date.now();
      for (const [_, clientSocket] of this.io.sockets.sockets) {
        if (clientSocket.data?.tokenExp && now > clientSocket.data.tokenExp) {
          clientSocket.emit('auth:expired', { message: 'Token đã hết hạn' });
          clientSocket.disconnect(true);
        }
      }
    }, 15000).unref();

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

        // Nhận gói tin telemetry liên tục từ Pi 5 qua Socket.IO (hỗ trợ ACK callback xác thực commit)
        socket.on(REALTIME_EVENTS.DEVICE_TELEMETRY, async (payload: unknown, ackCallback?: (response: any) => void) => {
          try {
            const parsed = deviceTelemetryInputSchema.safeParse(payload);
            if (!parsed.success) {
              const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
              console.warn(`[RealtimeGateway] Invalid device:telemetry packet from ${deviceId}: ${issues}`);
              if (typeof ackCallback === 'function') {
                ackCallback({ success: false, status: 'VALIDATION_FAILED', error: issues });
              }
              return;
            }

            const normalizedDeviceId = normalizeDeviceId(parsed.data.deviceId);
            // Thời điểm Backend nhận gói (đồng hồ server, không lấy từ Pi).
            const serverReceivedAt = new Date();
            const normalizedData = {
              ...parsed.data,
              deviceId: normalizedDeviceId,
              receivedAt: serverReceivedAt.toISOString(),
              lastHeartbeat: serverReceivedAt.toISOString()
            };
            const stationCode = (parsed.data.stationCode || 'STATION_A').toUpperCase();

            // Kích hoạt cảnh báo lỗi nắp nếu telemetry mang cờ lidAlert
            if (parsed.data.lidAlert) {
              this.handleLidAlert({
                deviceId: normalizedDeviceId,
                stationCode,
                lidAlert: true
              });
            }

            // 1. Cập nhật RealDeviceService trong RAM và phát Socket.IO 'device:heartbeat'
            // CHỈ cập nhật RAM của RealDeviceService cho Station A (Raspberry Pi 5 Gateway / Station A hardware)
            // Tuyệt đối không ghi đè RAM state của Station A khi nhận telemetry từ Station B!
            if (stationCode === 'STATION_A') {
              realDeviceService.recordHeartbeat(normalizedData, this.io);
            } else {
              if (stationCode === 'STATION_B') {
                realDeviceService.recordStationBHeartbeat(normalizedData);
              }
              // 2. Broadcast nhịp tim cho các trạm khác (ví dụ: STATION_B) một lần duy nhất tới toàn bộ client
              this.io.emit('device:heartbeat', normalizedData);
            }

            // 3. Xử lý Ingestion bền vững và bảo đảm Idempotency nếu có dữ liệu cảm biến
            const binResults: Array<{ binCode: string; status: string }> = [];

            if (parsed.data.sensors && !env.isDemoMode) {
              const sensors = parsed.data.sensors;
              const compartments: Array<{ binCode: string; data?: any }> = [
                { binCode: 'RECYCLABLE', data: sensors.recyclable },
                { binCode: 'NON_RECYCLABLE', data: sensors.nonRecyclable },
                { binCode: 'ORGANIC', data: sensors.organic }
              ];

              for (const comp of compartments) {
                if (comp.data) {
                  const sensorStatus = comp.data.status || (typeof comp.data.fillLevel === 'number' ? 'OK' : 'NOT_INSTALLED');
                  try {
                    const result = await unifiedTelemetryIngestionService.ingest({
                      stationCode,
                      binCode: comp.binCode,
                      fillLevel: comp.data.fillLevel ?? null,
                      distanceCm: comp.data.distanceCm ?? null,
                      sensorStatus: sensorStatus as any,
                      clientMessageId: parsed.data.clientMessageId ? `${parsed.data.clientMessageId}:${comp.binCode}` : undefined,
                      bootCount: parsed.data.bootCount !== undefined ? BigInt(parsed.data.bootCount) : undefined,
                      bootId: parsed.data.bootId,
                      sampleSeq: parsed.data.sampleSeq,
                      payloadHash: parsed.data.payloadHash,
                      isLegacy: parsed.data.isLegacy,
                      timestamp: projectSensorTimestamp(parsed.data.sentAt, comp.data.updatedAt, serverReceivedAt)
                    });
                    binResults.push({ binCode: comp.binCode, status: result.status });
                  } catch (ingestErr) {
                    console.error(`[RealtimeGateway] Ingestion error on ${stationCode} ${comp.binCode}:`, ingestErr);
                    binResults.push({ binCode: comp.binCode, status: 'INGESTION_ERROR' });
                  }
                }
              }
            }

            const { success: ingestionSuccess, status: ingestionStatus } = summarizeIngestionResults(binResults);

            // 4. Chuyển tiếp tới DeviceHealthService để xử lý heartbeat thống nhất (PostgreSQL)
            const deviceType = stationCode === 'STATION_B'
              ? DeviceType.ULTRASONIC_SENSOR
              : DeviceType.RASPBERRY_PI;

            void deviceHealthService.processHeartbeat({
              deviceId: normalizedDeviceId,
              deviceName: parsed.data.deviceName || (stationCode === 'STATION_B' ? 'ESP32-C6 Trạm B' : 'Raspberry Pi 5 Gateway'),
              deviceType,
              uptimeSeconds: parsed.data.uptimeSeconds,
              cpuTempC: parsed.data.cpuTempC,
              firmwareVersion: parsed.data.firmwareVersion,
              ipAddress: parsed.data.ipAddress,
              sentAt: parsed.data.sentAt,
              sensors: parsed.data.sensors,
              metadata: {
                ...(parsed.data.metadata || {}),
                ...(parsed.data.subsystems ? { subsystems: parsed.data.subsystems } : {}),
                ...(parsed.data.aiDetection ? { aiDetection: parsed.data.aiDetection } : {})
              }
            }).catch((err) => {
              console.error(`[RealtimeGateway] Error processing heartbeat in DeviceHealthService for ${normalizedDeviceId}:`, err);
            });

            // 5. Phản hồi ACK callback cho client (bảo đảm Pi Agent chỉ prune khi commit thành công)
            if (typeof ackCallback === 'function') {
              ackCallback({
                success: ingestionSuccess,
                status: ingestionStatus,
                results: binResults,
                clientMessageId: parsed.data.clientMessageId,
                timestamp: new Date().toISOString()
              });
            }
          } catch (err) {
            console.error('[RealtimeGateway] Error processing device:telemetry:', err);
            if (typeof ackCallback === 'function') {
              ackCallback({
                success: false,
                status: 'INTERNAL_ERROR',
                error: err instanceof Error ? err.message : 'Unknown error'
              });
            }
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

        // Nhận cảnh báo lỗi nắp tức thời từ Raspberry Pi 5 (Station A)
        socket.on(REALTIME_EVENTS.LID_ALERT, (alertPayload: unknown) => {
          this.handleLidAlert(alertPayload);
        });

        // Nhận sự kiện thu gom thủ công trực tuyến từ Raspberry Pi 5 (Station A) kèm ACK xác nhận lưu DB
        socket.on(REALTIME_EVENTS.DEVICE_COLLECTION_EVENT, async (payload: unknown, ackCallback?: (response: any) => void) => {
          const rawEventId = typeof (payload as any)?.eventId === 'string' ? (payload as any).eventId : undefined;
          try {
            const result = await collectionSessionService.ingestEvent(payload);
            if (result.success && result.session) {
              this.io.emit(REALTIME_EVENTS.COLLECTION_SESSION_UPDATED, result.session);
            }
            if (typeof ackCallback === 'function') {
              ackCallback({
                ...result,
                eventId: result.eventId || rawEventId,
                timestamp: new Date().toISOString()
              });
            }
          } catch (err) {
            console.error('[RealtimeGateway] Error processing device:collection:event:', err);
            if (typeof ackCallback === 'function') {
              ackCallback({
                success: false,
                status: 'INTERNAL_ERROR',
                eventId: rawEventId,
                error: err instanceof Error ? err.message : 'Unknown error',
                timestamp: new Date().toISOString()
              });
            }
          }
        });

        socket.on('disconnect', (reason) => {
          console.log(`[RealtimeGateway] Device disconnected: ${deviceId} (${reason})`);
          realDeviceService.setSocketConnected(deviceId, false);
        });
      } else {
        // Web / Mobile client
        const userId = socket.data.userId;
        const role = socket.data.userRole || 'VIEWER';

        // Tự động gia nhập phòng người dùng để hỗ trợ thu hồi quyền tức thì
        if (userId && userId !== 'public-viewer') {
          void socket.join(`user:${userId}`);
        }

        // Tự động gia nhập phòng tổng quan xem tất cả các trạm
        void socket.join('dashboard:all_stations');

        // Người dùng quản trị gia nhập phòng tổng quan
        if (role === 'ADMIN' || role === 'SUPERVISOR') {
          void socket.join('admin:all_stations');
        }

        socket.emit(REALTIME_EVENTS.CONNECTED, {
          connectedAt: new Date().toISOString(),
          role: 'client',
          userId,
          userRole: role
        });

        // Xử lý đăng ký / hủy đăng ký theo dõi trạm
        const handleSubscribeStation = async (data: { stationCode?: string }, cb?: (res: any) => void) => {
          const rawCode = String(data?.stationCode || '').trim().toUpperCase();

          // Khi chọn xem "Tất cả các trạm" hoặc không truyền stationCode (hoặc truyền 'ALL')
          if (!rawCode || rawCode === 'ALL') {
            void socket.join('dashboard:all_stations');
            socket.emit('subscribed:station', { stationCode: 'ALL' });
            socket.emit('subscribed_station', { stationCode: 'ALL' });
            if (typeof cb === 'function') cb({ success: true, stationCode: 'ALL' });
            return;
          }

          // 1. Kiểm tra tính hợp lệ và quyền truy cập trạm
          if (rawCode !== 'STATION_A' && rawCode !== 'STATION_B') {
            try {
              const station = await prisma.station.findUnique({
                where: { code: rawCode },
                select: { id: true, code: true, isActive: true }
              });
              if (!station || !station.isActive) {
                socket.emit('error:station_access', {
                  stationCode: rawCode,
                  error: 'STATION_NOT_FOUND_OR_INACTIVE',
                  message: `Trạm '${rawCode}' không tồn tại hoặc đã bị vô hiệu hóa.`
                });
                if (typeof cb === 'function') cb({ success: false, error: 'STATION_NOT_FOUND_OR_INACTIVE' });
                return;
              }
            } catch {
              // Nếu DB không truy cập được, chỉ cho phép trạm mặc định
            }
          }

          // 2. Chuyển trạm: Rời toàn bộ phòng trạm cũ trước khi gia nhập trạm mới
          for (const room of socket.rooms) {
            if (room.startsWith('station:') && (room.endsWith(':telemetry') || room.endsWith(':alerts'))) {
              void socket.leave(room);
            }
          }

          // 3. Gia nhập phòng của trạm mới
          void socket.join(`station:${rawCode}:telemetry`);
          void socket.join(`station:${rawCode}:alerts`);

          // Phát xác nhận theo cả hai định dạng sự kiện (chuẩn hóa ':' và kế thừa '_')
          socket.emit('subscribed:station', { stationCode: rawCode });
          socket.emit('subscribed_station', { stationCode: rawCode });
          if (typeof cb === 'function') cb({ success: true, stationCode: rawCode });
        };

        const handleUnsubscribeStation = (data: { stationCode?: string }, cb?: (res: any) => void) => {
          const rawCode = String(data?.stationCode || 'STATION_A').trim().toUpperCase();
          void socket.leave(`station:${rawCode}:telemetry`);
          void socket.leave(`station:${rawCode}:alerts`);

          socket.emit('unsubscribed:station', { stationCode: rawCode });
          socket.emit('unsubscribed_station', { stationCode: rawCode });
          if (typeof cb === 'function') cb({ success: true, stationCode: rawCode });
        };

        // Hỗ trợ cả 2 định dạng sự kiện: 'subscribe:station' (chuẩn mới) và 'subscribe_station' (kế thừa)
        socket.on('subscribe:station', handleSubscribeStation);
        socket.on('subscribe_station', handleSubscribeStation);

        socket.on('unsubscribe:station', handleUnsubscribeStation);
        socket.on('unsubscribe_station', handleUnsubscribeStation);

        socket.on('disconnect', (reason) => {
          if (reason !== 'client namespace disconnect') {
            console.log(`Socket client disconnected: ${reason}`);
          }
        });
      }
    });
  }

  /**
   * Thu hồi phiên người dùng lập tức (SLA <= 3.0 giây).
   * Được gọi khi Admin khóa tài khoản (User.isActive = false) hoặc người dùng đăng xuất.
   */
  public revokeUserSessions(userId: string, reason = 'ACCOUNT_DISABLED'): void {
    const room = `user:${userId}`;
    this.io.in(room).emit('auth:revoked', { reason, message: 'Tài khoản đã bị vô hiệu hóa hoặc phiên đăng nhập đã hết hiệu lực.' });
    this.io.in(room).disconnectSockets(true);
    console.log(`[RealtimeGateway] Revoked active sockets for user ${userId} (SLA immediate disconnect)`);
  }

  public emitTelemetry(event: RealtimeTelemetryPayload & { stationCode?: string }): void {
    const stationCode = (event.stationCode || 'STATION_A').toUpperCase();
    // 1. Phát tới phòng trạm tương ứng (Multi-tenant scoped)
    this.io.to(`station:${stationCode}:telemetry`).emit(REALTIME_EVENTS.BIN_TELEMETRY, event);
    this.io.to(`station:${stationCode}:telemetry`).emit(REALTIME_EVENTS.TELEMETRY, event);

    // 2. Phát tới phòng quản trị toàn hệ thống
    this.io.to('admin:all_stations').emit(REALTIME_EVENTS.BIN_TELEMETRY, event);
    this.io.to('admin:all_stations').emit(REALTIME_EVENTS.TELEMETRY, event);

    // 3. Phát toàn cục để tương thích ngược với Web Dashboard hiện hành
    this.io.emit(REALTIME_EVENTS.BIN_TELEMETRY, event);
    this.io.emit(REALTIME_EVENTS.TELEMETRY, event);
  }

  public emitDeviceStatus(device: DeviceStatusPayload): void {
    const normalized = {
      ...device,
      deviceId: normalizeDeviceId(device.deviceId)
    };
    this.io.emit(REALTIME_EVENTS.DEVICE_STATUS, normalized);
  }

  public emitAlert(event: RealtimeAlertPayload & { stationCode?: string }): void {
    const stationCode = (event.stationCode || 'STATION_A').toUpperCase();
    this.io.to(`station:${stationCode}:alerts`).emit(REALTIME_EVENTS.ALERT_CREATED, event);
    this.io.to('admin:all_stations').emit(REALTIME_EVENTS.ALERT_CREATED, event);
    this.io.emit(REALTIME_EVENTS.ALERT_CREATED, event);
    this.io.emit(REALTIME_EVENTS.ALERT, event);
  }

  public emitAlertResolved(event: RealtimeAlertPayload & { stationCode?: string }): void {
    const stationCode = (event.stationCode || 'STATION_A').toUpperCase();
    this.io.to(`station:${stationCode}:alerts`).emit(REALTIME_EVENTS.ALERT_RESOLVED, event);
    this.io.to('admin:all_stations').emit(REALTIME_EVENTS.ALERT_RESOLVED, event);
    this.io.emit(REALTIME_EVENTS.ALERT_RESOLVED, event);
    this.io.emit(REALTIME_EVENTS.ALERT_UPDATED, event);
    this.io.emit(REALTIME_EVENTS.ALERT, event);
  }

  public emitThresholdsUpdated(thresholds: {
    warningThreshold: number;
    nearFullThreshold: number;
    fullThreshold: number;
    updatedAt?: string | Date;
  }): void {
    const payload = {
      warningThreshold: thresholds.warningThreshold,
      nearFullThreshold: thresholds.nearFullThreshold,
      fullThreshold: thresholds.fullThreshold,
      updatedAt: (thresholds.updatedAt ? new Date(thresholds.updatedAt) : new Date()).toISOString()
    };
    this.io.emit(REALTIME_EVENTS.SETTINGS_THRESHOLDS_UPDATED, payload);
    this.io.emit('settings:thresholds', payload);
  }

  public handleLidAlert(payload?: unknown): void {
    const alreadyActive = realDeviceService.isLidAlertActive();
    realDeviceService.setLidAlert(true);

    // Nếu cảnh báo lỗi nắp đã được phát trước đó, không phát lại alert:created để tránh tạo 2 cảnh báo trùng lặp
    if (alreadyActive) {
      return;
    }

    const message = 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!';
    const alertEvent = {
      deviceId: 'raspberry-pi-5',
      stationCode: 'STATION_A',
      message,
      lidAlert: true,
      timestamp: new Date().toISOString()
    };

    // 1. Phát sự kiện chuyên biệt device:lid:alert tới tất cả client
    this.io.emit(REALTIME_EVENTS.LID_ALERT, alertEvent);

    // 2. Đồng thời phát cảnh báo hệ thống alert:created (ID cố định để chống trùng lặp)
    this.emitAlert({
      id: 'lid-alert-station-a',
      type: 'HARDWARE_FAULT' as any,
      severity: 'CRITICAL' as any,
      message,
      binId: null,
      deviceId: 'raspberry-pi-5',
      isResolved: false,
      createdAt: new Date().toISOString(),
      stationCode: 'STATION_A'
    });
  }
}
