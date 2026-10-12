import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

export type RoleName = 'ADMIN' | 'SUPERVISOR' | 'WORKER';
const tokenPayloadSchema = z.object({ sub: z.string().min(1) });
export interface AuthenticatedRequest extends Request {
  user?: { userId: string; role: RoleName };
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