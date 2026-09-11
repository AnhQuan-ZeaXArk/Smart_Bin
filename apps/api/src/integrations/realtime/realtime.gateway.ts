import { Server } from 'socket.io';
import type { Server as NodeHttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

const tokenSchema = z.object({ sub: z.string().min(1) });

export type TelemetryEvent = { binCode: string; fillLevel: number; fillCategory: string; distanceCm: number; timestamp: string };
export type NfcAccessEvent = { binCode: string | null; uid: string; result: string; reason: string; employeeId: string | null; timestamp: string };

export class RealtimeGateway {
  readonly io: Server;

  constructor(httpServer: NodeHttpServer) {
    this.io = new Server(httpServer, { cors: { origin: env.WEB_ORIGIN } });
    this.io.use(async (socket, next) => {
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
      socket.emit('realtime:connected', { connectedAt: new Date().toISOString() });
      socket.on('disconnect', (reason) => console.log(`Socket disconnected: ${reason}`));
    });
  }

  emitTelemetry(event: TelemetryEvent) { this.io.emit('bin:telemetry', event); }
  emitNfcAccess(event: NfcAccessEvent) { this.io.emit('nfc:access', event); }
  emitAlert(event: unknown) { this.io.emit('alert:created', event); }
}
