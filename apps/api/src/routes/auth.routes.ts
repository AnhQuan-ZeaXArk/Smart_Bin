import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

router.post('/login', async (request, response, next) => {
  try {
    const { username, password } = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ include: { role: true }, where: { username } });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      return response.status(401).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({}, env.JWT_SECRET, { subject: user.id, expiresIn: env.JWT_EXPIRES_IN as StringValue });
    return response.json({ token, user: { id: user.id, username: user.username, role: user.role.name } });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  try {
    const user = await prisma.user.findUnique({ include: { role: true, employee: true }, where: { id: request.user!.userId } });
    return user ? response.json({ id: user.id, username: user.username, role: user.role.name, employee: user.employee }) : response.status(404).json({ message: 'User not found' });
  } catch (error) {
    return next(error);
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mật khẩu hiện tại không được để trống.'),
  newPassword: z.string().min(6, 'Mật khẩu mới phải có tối thiểu 6 ký tự.'),
  confirmPassword: z.string().min(1, 'Xác nhận mật khẩu không được để trống.')
});

router.patch('/me/password', requireAuth, async (request: AuthenticatedRequest, response, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ.';
      return response.status(400).json({ message: firstError });
    }

    const { currentPassword, newPassword, confirmPassword } = parsed.data;

    if (newPassword !== confirmPassword) {
      return response.status(400).json({ message: 'Mật khẩu xác nhận không khớp.' });
    }

    if (newPassword === currentPassword) {
      return response.status(400).json({ message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.' });
    }

    const userId = request.user!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      return response.status(404).json({ message: 'Không tìm thấy tài khoản.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return response.status(400).json({ message: 'Mật khẩu hiện tại không chính xác.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });

    return response.json({ message: 'Đổi mật khẩu thành công.' });
  } catch (error) {
    return next(error);
  }
});

export default router;