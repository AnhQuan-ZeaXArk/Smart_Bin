import bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

import { env } from '../config/env.js';
import { demoService } from '../demo/demo.service.js';

const router = Router();
const roleSchema = z.enum(['ADMIN', 'SUPERVISOR', 'WORKER']);

function getUserId(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value;
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
}

function serializeUser(user: { id: string; username: string; displayName?: string | null; isActive: boolean; role: { name: string } }) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
    role: user.role.name,
    isActive: user.isActive
  };
}

router.get('/users', requireAuth, requireRole('ADMIN'), async (_request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_DISABLED',
          message: 'Chức năng quản lý người dùng không khả dụng trong chế độ Demo.'
        }
      });
    }

    const users = await prisma.user.findMany({ include: { role: true }, orderBy: { createdAt: 'desc' } });
    return response.json({ users: users.map(serializeUser) });
  } catch (error) {
    return next(error);
  }
});

router.post('/users', requireAuth, requireRole('ADMIN'), async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_DISABLED',
          message: 'Chức năng quản lý người dùng không khả dụng trong chế độ Demo.'
        }
      });
    }
    const parsed = z.object({
      username: z.string().trim().min(1),
      displayName: z.string().trim().min(1),
      password: z.string().min(6, 'Mật khẩu phải có tối thiểu 6 ký tự.'),
      confirmPassword: z.string().min(6, 'Mật khẩu xác nhận phải có tối thiểu 6 ký tự.'),
      role: roleSchema,
      isActive: z.boolean().optional().default(true)
    }).safeParse(request.body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Thông tin tài khoản không hợp lệ.';
      return response.status(400).json({ message: firstError });
    }

    const { username, displayName, password, confirmPassword, role, isActive } = parsed.data;

    if (!username.trim()) return response.status(400).json({ message: 'Tên người dùng không được để trống.' });
    if (!displayName.trim()) return response.status(400).json({ message: 'Tên hiển thị không được để trống.' });
    if (!password.trim()) return response.status(400).json({ message: 'Mật khẩu không được để trống.' });
    if (password.length < 6) return response.status(400).json({ message: 'Mật khẩu phải có tối thiểu 6 ký tự.' });
    if (password !== confirmPassword) return response.status(400).json({ message: 'Mật khẩu xác nhận không khớp.' });

    const existingUser = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (existingUser) return response.status(409).json({ message: 'Tên người dùng đã tồn tại.' });

    const assignedRole = await prisma.role.findUnique({ where: { name: role } });
    if (!assignedRole) return response.status(400).json({ message: 'Vai trò không hợp lệ.' });

    const createdUser = await prisma.user.create({
      data: {
        username: username.trim(),
        displayName: displayName.trim(),
        passwordHash: await bcrypt.hash(password, 12),
        roleId: assignedRole.id,
        isActive
      },
      include: { role: true }
    });

    return response.status(201).json({ user: serializeUser(createdUser), message: 'Tạo tài khoản thành công.' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id', requireAuth, requireRole('ADMIN'), async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_DISABLED',
          message: 'Chức năng quản lý người dùng không khả dụng trong chế độ Demo.'
        }
      });
    }

    const userId = getUserId(request.params.id);
    if (!userId) return response.status(400).json({ message: 'ID tài khoản không hợp lệ.' });

    const parsed = z.object({
      username: z.string().trim().min(1).optional(),
      displayName: z.string().trim().min(1).optional(),
      role: roleSchema.optional(),
      isActive: z.boolean().optional()
    }).safeParse(request.body);

    if (!parsed.success) return response.status(400).json({ message: 'Thông tin cập nhật không hợp lệ.' });

    const existingUser = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!existingUser) return response.status(404).json({ message: 'Không tìm thấy tài khoản.' });

    const nextUsername = parsed.data.username?.trim();
    if (nextUsername && nextUsername !== existingUser.username) {
      const duplicate = await prisma.user.findUnique({ where: { username: nextUsername } });
      if (duplicate) return response.status(409).json({ message: 'Tên người dùng đã tồn tại.' });
    }

    const nextRole = parsed.data.role ? await prisma.role.findUnique({ where: { name: parsed.data.role } }) : null;
    if (parsed.data.role && !nextRole) return response.status(400).json({ message: 'Vai trò không hợp lệ.' });

    const updateData: Prisma.UserUpdateInput = {};

    if (nextUsername) {
      updateData.username = nextUsername;
    }

    if (parsed.data.displayName) {
      updateData.displayName = parsed.data.displayName.trim();
    }

    if (parsed.data.isActive !== undefined) {
      updateData.isActive = parsed.data.isActive;
    }

    if (nextRole) {
      updateData.role = { connect: { id: nextRole.id } };
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: { role: true }
    });

    return response.json({ user: serializeUser(updatedUser), message: 'Cập nhật tài khoản thành công.' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id/status', requireAuth, requireRole('ADMIN'), async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_DISABLED',
          message: 'Chức năng quản lý người dùng không khả dụng trong chế độ Demo.'
        }
      });
    }

    const userId = getUserId(request.params.id);
    if (!userId) return response.status(400).json({ message: 'ID tài khoản không hợp lệ.' });

    const parsed = z.object({ isActive: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ message: 'Trạng thái không hợp lệ.' });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user) return response.status(404).json({ message: 'Không tìm thấy tài khoản.' });

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isActive: parsed.data.isActive },
      include: { role: true }
    });

    if (!parsed.data.isActive) {
      const realtime = request.app.get('realtime');
      if (realtime && typeof realtime.revokeUserSessions === 'function') {
        realtime.revokeUserSessions(userId, 'ACCOUNT_DISABLED');
      }
    }

    return response.json({ user: serializeUser(updated), message: parsed.data.isActive ? 'Tài khoản đã được kích hoạt.' : 'Tài khoản đã được vô hiệu hóa.' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id/password', requireAuth, requireRole('ADMIN'), async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_DISABLED',
          message: 'Chức năng quản lý người dùng không khả dụng trong chế độ Demo.'
        }
      });
    }

    const userId = getUserId(request.params.id);
    if (!userId) return response.status(400).json({ message: 'ID tài khoản không hợp lệ.' });

    const parsed = z.object({
      password: z.string().min(6, 'Mật khẩu phải có tối thiểu 6 ký tự.'),
      confirmPassword: z.string().min(6, 'Mật khẩu xác nhận phải có tối thiểu 6 ký tự.')
    }).safeParse(request.body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Mật khẩu không hợp lệ.';
      return response.status(400).json({ message: firstError });
    }

    const { password, confirmPassword } = parsed.data;
    if (!password.trim()) return response.status(400).json({ message: 'Mật khẩu không được để trống.' });
    if (password.length < 6) return response.status(400).json({ message: 'Mật khẩu phải có tối thiểu 6 ký tự.' });
    if (password !== confirmPassword) return response.status(400).json({ message: 'Mật khẩu xác nhận không khớp.' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return response.status(404).json({ message: 'Không tìm thấy tài khoản.' });

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(password, 12) }
    });

    return response.json({ message: 'Mật khẩu đã được cập nhật.' });
  } catch (error) {
    return next(error);
  }
});

router.get('/collections', requireAuth, async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.json({ collections: demoService.getCollections() });
    }

    const rawStationId = typeof request.query.stationId === 'string' ? request.query.stationId : undefined;
    const rawStationCode = typeof request.query.stationCode === 'string' ? request.query.stationCode : undefined;

    let targetStationId = rawStationId;
    if (!targetStationId && rawStationCode) {
      const station = await prisma.station.findUnique({ where: { code: rawStationCode } });
      if (station) targetStationId = station.id;
    }

    const collections = await prisma.collectionRecord.findMany({
      include: {
        bin: {
          select: {
            binCode: true,
            name: true,
            stationId: true,
            station: { select: { code: true, name: true } }
          }
        }
      },
      where: {
        ...(targetStationId ? { bin: { stationId: targetStationId } } : {})
      },
      orderBy: { collectedAt: 'desc' },
      take: 200
    });
    return response.json({ collections });
  } catch (error) {
    return next(error);
  }
});

export default router;