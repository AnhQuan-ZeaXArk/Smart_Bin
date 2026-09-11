import { AlertSeverity, AlertType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function updateFillAlert(binId: string, binCode: string, fillLevel: number) {
  if (fillLevel < 75) {
    await prisma.alert.updateMany({ where: { binId, isResolved: false, type: { in: [AlertType.NEARLY_FULL, AlertType.CRITICAL] } }, data: { isResolved: true, resolvedAt: new Date() } });
    return null;
  }
  const type = fillLevel >= 90 ? AlertType.CRITICAL : AlertType.NEARLY_FULL;
  const severity = fillLevel >= 90 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING;
  const existing = await prisma.alert.findFirst({ where: { binId, type, isResolved: false }, orderBy: { createdAt: 'desc' } });
  if (existing) return existing;
  return prisma.alert.create({ data: { binId, type, severity, message: `${binCode} fill level is ${fillLevel}%` } });
}
