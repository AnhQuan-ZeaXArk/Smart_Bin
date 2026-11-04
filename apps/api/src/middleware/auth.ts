import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

export type RoleName = 'ADMIN' | 'SUPERVISOR' | 'WORKER';
const tokenPayloadSchema = z.object({ sub: z.string().min(1) });
export interface AuthenticatedRequest extends Request {
  user?: { userId: string; role: RoleName };
}

/**
 * So sánh chuỗi an toàn chống tấn công timing attack (constant-time comparison).
 * Băm SHA-256 cả hai chuỗi để bảo đảm luôn có 2 Buffer cố định 32 bytes,
 * không làm rò rỉ độ dài chuỗi và an toàn trước mọi ngoại lệ length mismatch.
 */
export function timingSafeCompare(a?: unknown, b?: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (!a || !b) {
    return false;
  }

  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();

  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Middleware: Xác thực thiết bị bằng Bearer Token (DEVICE_INGEST_TOKEN)
 * Thiết bị phần cứng gửi heartbeat với header: Authorization: Bearer <DEVICE_INGEST_TOKEN>
 * So sánh an toàn chống tấn công timing attack (constant-time comparison)
 */
export function authenticateDeviceToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Thiếu header Authorization: Bearer <DEVICE_INGEST_TOKEN>'
    });
  }

  const token = authHeader.slice(7).trim();
  const configuredToken = (process.env.DEVICE_INGEST_TOKEN || env.DEVICE_INGEST_TOKEN || '').trim();

  if (!configuredToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'DEVICE_INGEST_TOKEN chưa được cấu hình trên máy chủ'
    });
  }

  if (!timingSafeCompare(token, configuredToken)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Token xác thực thiết bị không chính xác'
    });
  }

  return next();
}

export async function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  if (env.isDemoMode) {
    request.user = { userId: 'demo-operator', role: 'ADMIN' };
    return next();
  }

  const token = request.header('authorization')?.replace('Bearer ', '');
  if (!token) return response.status(401).json({ message: 'Authentication required' });
  try {
    const payload = tokenPayloadSchema.parse(jwt.verify(token, env.JWT_SECRET));
    const user = await prisma.user.findUnique({ include: { role: true }, where: { id: payload.sub } });
    if (!user || !user.isActive) return response.status(401).json({ message: 'User is inactive or not found' });
    request.user = { userId: user.id, role: user.role.name };
    return next();
  } catch (error) {
    if (error instanceof z.ZodError) return response.status(401).json({ message: 'Invalid token payload' });
    return response.status(401).json({ message: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: RoleName[]) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    if (env.isDemoMode) {
      return next();
    }

    if (!request.user || !roles.includes(request.user.role)) {
      return response.status(403).json({ message: 'Insufficient permissions' });
    }
    return next();
  };
}
