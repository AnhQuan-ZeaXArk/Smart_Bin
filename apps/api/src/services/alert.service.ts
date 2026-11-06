import { AlertSeverity, AlertType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { settingsService } from './settings.service.js';

export async function updateFillAlert(binId: string, binCode: string, fillLevel: number) {
  const thresholds = await settingsService.getThresholds();
  const now = new Date();

  // Dưới ngưỡng cảnh báo: Tự động đánh dấu đã xử lý (resolve) các cảnh báo mức đầy cũ
  if (fillLevel < thresholds.warningThreshold) {
    await prisma.alert.updateMany({
      where: {
        binId,
        isResolved: false,
        type: { in: [AlertType.NEARLY_FULL, AlertType.CRITICAL] }
      },
      data: { isResolved: true, resolvedAt: now }
    });
    return null;
  }

  // Đạt hoặc vượt ngưỡng đầy (fullThreshold) -> CRITICAL
  // Đạt hoặc vượt ngưỡng gần đầy (nearFullThreshold) -> WARNING
  // Đạt ngưỡng cảnh báo (warningThreshold) -> INFO / NEARLY_FULL
  const isFull = fillLevel >= thresholds.fullThreshold;
  const isNearFull = fillLevel >= thresholds.nearFullThreshold;

  const currentType = isFull ? AlertType.CRITICAL : AlertType.NEARLY_FULL;
  const currentSeverity = isFull ? AlertSeverity.CRITICAL : isNearFull ? AlertSeverity.WARNING : AlertSeverity.INFO;

  // Giải quyết cảnh báo mức đầy khác loại để không tồn đọng sai trạng thái
  // (ví dụ: khi lên CRITICAL thì giải quyết NEARLY_FULL cũ; khi hạ xuống NEARLY_FULL thì giải quyết CRITICAL cũ)
  const obsoleteType = isFull ? AlertType.NEARLY_FULL : AlertType.CRITICAL;
  await prisma.alert.updateMany({
    where: {
      binId,
      isResolved: false,
      type: obsoleteType
    },
    data: { isResolved: true, resolvedAt: now }
  });

  const existing = await prisma.alert.findFirst({
    where: { binId, type: currentType, isResolved: false },
    orderBy: { createdAt: 'desc' }
  });

  if (existing) {
    // Nếu mức độ nghiêm trọng (severity) thay đổi (ví dụ: chạm mốc gần đầy tăng từ INFO lên WARNING), cập nhật bản ghi hiện tại
    if (existing.severity !== currentSeverity) {
      return prisma.alert.update({
        where: { id: existing.id },
        data: {
          severity: currentSeverity,
          message: `${binCode} fill level is ${fillLevel}% (ngưỡng: cảnh báo ${thresholds.warningThreshold}%, gần đầy ${thresholds.nearFullThreshold}%, đầy ${thresholds.fullThreshold}%)`
        }
      });
    }
    return existing;
  }

  return prisma.alert.create({
    data: {
      binId,
      type: currentType,
      severity: currentSeverity,
      message: `${binCode} fill level is ${fillLevel}% (ngưỡng: cảnh báo ${thresholds.warningThreshold}%, gần đầy ${thresholds.nearFullThreshold}%, đầy ${thresholds.fullThreshold}%)`
    }
  });
}
