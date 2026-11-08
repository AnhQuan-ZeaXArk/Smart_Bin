import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { env } from '../config/env.js';

const router = Router();

const commissionSchema = z.object({
  expectedBootId: z.string().trim().min(1),
  resetReason: z.string().trim().min(1),
  notes: z.string().trim().optional()
});

// GET /api/stations - Lấy danh sách tất cả các trạm
router.get('/', async (_request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.json({
        stations: [
          {
            id: 'station_a_canonical_id',
            code: 'STATION_A',
            name: 'Trạm Thu gom Trung tâm A',
            status: 'ONLINE',
            isActive: true,
            location: 'Khuôn viên chính',
            binsCount: 3,
            installedBinsCount: 3
          },
          {
            id: 'station_b_canonical_id',
            code: 'STATION_B',
            name: 'Trạm Thu gom Mở rộng B',
            status: 'OFFLINE',
            isActive: false,
            location: 'Khuôn viên phía Đông',
            binsCount: 3,
            installedBinsCount: 1
          }
        ]
      });
    }

    const stations = await prisma.station.findMany({
      include: {
        bins: {
          select: {
            id: true,
            binCode: true,
            name: true,
            status: true,
            isActive: true,
            installed: true,
            currentFillLevel: true
          }
        }
      },
      orderBy: { code: 'asc' }
    });

    const formatted = stations.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      status: s.status,
      isActive: s.isActive,
      location: s.location,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      binsCount: s.bins.length,
      installedBinsCount: s.bins.filter((b) => b.installed).length,
      bins: s.bins
    }));

    return response.json({ stations: formatted });
  } catch (error) {
    return next(error);
  }
});

// GET /api/stations/:id - Lấy thông tin chi tiết một trạm
router.get('/:id', async (request, response, next) => {
  try {
    const id = String(request.params.id || '');
    const station = await prisma.station.findFirst({
      where: {
        OR: [{ id }, { code: id }]
      },
      include: {
        bins: {
          select: {
            id: true,
            binCode: true,
            name: true,
            status: true,
            isActive: true,
            installed: true,
            currentFillLevel: true,
            lastSeen: true
          }
        }
      }
    });

    if (!station) {
      return response.status(404).json({ error: { code: 'STATION_NOT_FOUND', message: 'Không tìm thấy trạm' } });
    }

    return response.json({ station });
  } catch (error) {
    return next(error);
  }
});

// PUT /api/stations/:id/activate - Kích hoạt quản trị trạm (isActive = true)
// QUY TẮC BẤT BIẾN: Chỉ bật cờ isActive, status VẪN GIỮ OFFLINE cho đến khi Health Aggregator xác nhận heartbeat thực tế!
router.put('/:id/activate', requireAuth, requireRole('ADMIN', 'SUPERVISOR'), async (request, response, next) => {
  try {
    const id = String(request.params.id || '');
    const station = await prisma.station.findFirst({
      where: { OR: [{ id }, { code: id }] }
    });

    if (!station) {
      return response.status(404).json({ error: { code: 'STATION_NOT_FOUND', message: 'Không tìm thấy trạm' } });
    }

    const updated = await prisma.station.update({
      where: { id: station.id },
      data: {
        isActive: true
        // status giữ nguyên OFFLINE, không tự động đặt ONLINE!
      }
    });

    return response.json({
      success: true,
      message: `Trạm ${station.code} đã được kích hoạt quản trị hành chính. Trạng thái sức khỏe sẽ tự chuyển sang ONLINE khi nhận được luồng dữ liệu cảm biến thực tế.`,
      station: updated
    });
  } catch (error) {
    return next(error);
  }
});

// PUT /api/stations/:id/deactivate - Ngắt hoạt động mềm (Soft Deactivation)
router.put('/:id/deactivate', requireAuth, requireRole('ADMIN'), async (request, response, next) => {
  try {
    const id = String(request.params.id || '');
    const station = await prisma.station.findFirst({
      where: { OR: [{ id }, { code: id }] }
    });

    if (!station) {
      return response.status(404).json({ error: { code: 'STATION_NOT_FOUND', message: 'Không tìm thấy trạm' } });
    }

    const updated = await prisma.station.update({
      where: { id: station.id },
      data: {
        isActive: false,
        status: 'MAINTENANCE'
      }
    });

    return response.json({
      success: true,
      message: `Trạm ${station.code} đã ngắt hoạt động mềm. Dữ liệu lịch sử được bảo toàn nguyên vẹn.`,
      station: updated
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/stations/:stationCode/commission - Quản trị viên duyệt Commissioning mở khóa phiên sau khi reset NVS
router.post('/:stationCode/commission', requireAuth, requireRole('ADMIN'), async (request, response, next) => {
  try {
    const stationCode = String(request.params.stationCode || '').toUpperCase();
    const parsed = commissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dữ liệu commissioning không hợp lệ',
          details: parsed.error.issues
        }
      });
    }

    const station = await prisma.station.findUnique({ where: { code: stationCode } });
    if (!station) {
      return response.status(404).json({ error: { code: 'STATION_NOT_FOUND', message: `Không tìm thấy trạm ${stationCode}` } });
    }

    const { expectedBootId, resetReason, notes } = parsed.data;

    // 1. Ghi vết kiểm toán bất biến
    await prisma.migrationProvenance.create({
      data: {
        phase: 'COMMISSIONING',
        action: 'STATION_COMMISSIONED',
        target: `Station:${stationCode}`,
        status: 'APPLIED',
        notes: `Admin ${(request as any).user?.username || 'authorized'} approved commissioning for ${stationCode}. Reason: ${resetReason}. ExpectedBootId: ${expectedBootId}. Notes: ${notes || 'none'}`
      }
    });

    // 2. Thiết lập lại Watermark cho tất cả các ngăn rác của trạm
    const bins = await prisma.bin.findMany({ where: { stationId: station.id } });
    for (const b of bins) {
      await prisma.stationWatermark.upsert({
        where: {
          stationCode_binCode: {
            stationCode,
            binCode: b.binCode
          }
        },
        create: {
          stationCode,
          binCode: b.binCode,
          bootCount: 0n,
          bootId: expectedBootId,
          lastSampleSeq: 0,
          lastPayloadHash: 'INITIAL_COMMISSIONING_HASH'
        },
        update: {
          bootCount: 0n,
          bootId: expectedBootId,
          lastSampleSeq: 0,
          lastPayloadHash: 'RESET_COMMISSIONING_HASH',
          updatedAt: new Date()
        }
      });
    }

    // 3. Giải quyết mọi cảnh báo COMMISSIONING_REQUIRED đang mở cho trạm này
    await prisma.alert.updateMany({
      where: {
        type: 'COMMISSIONING_REQUIRED',
        isResolved: false,
        bin: { stationId: station.id }
      },
      data: {
        isResolved: true,
        resolvedAt: new Date()
      }
    });

    return response.status(200).json({
      success: true,
      message: `Trạm ${stationCode} đã được phê duyệt Commissioning thành công. Phiên boot mới '${expectedBootId}' đã mở khóa tiếp nhận dữ liệu.`,
      stationCode,
      expectedBootId
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
