import { Server } from 'socket.io';
import type { Server as NodeHttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import {
  REALTIME_EVENTS,
  type DeviceStatusPayload,
  type RealtimeAlertPayload,
  type RealtimeTelemetryPayload
} from './realtime.contract.js';

export * from './realtime.contract.js';
export type TelemetryEvent = RealtimeTelemetryPayload;

const tokenSchema = z.object({ sub: z.string().min(1) });

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
      if (env.isDemoMode) {
        socket.data.userId = 'demo-operator';
        return next();
      }

      try {
        const token = socket.handshake.auth.token as string | undefined;
        if (!token) return next(new Error('Authentication required'));
        const payload = tokenSchema.parse(jwt.verify(token, env.JWT_SECRET));
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user?.isActive) return next(new Error('User is inactive or not found'));
        socket.data.userId = user.id;
        return next();
      } catch {
        return next(new Error('Invalid or expired token'));
      }
    });

    this.io.on('connection', (socket) => {
      socket.emit(REALTIME_EVENTS.CONNECTED, { connectedAt: new Date().toISOString() });
      socket.on('disconnect', (reason) => {
        // Safe logging without exposing secrets
        if (reason !== 'client namespace disconnect') {
          console.log(`Socket disconnected: ${reason}`);
        }
      });
    });
  }

  emitTelemetry(event: RealtimeTelemetryPayload): void {
    this.io.emit(REALTIME_EVENTS.BIN_TELEMETRY, event);
    this.io.emit(REALTIME_EVENTS.TELEMETRY, event);
  }

  emitDeviceStatus(device: DeviceStatusPayload): void {
    this.io.emit(REALTIME_EVENTS.DEVICE_STATUS, device);
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
