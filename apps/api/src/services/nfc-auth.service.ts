import { AccessReason, AccessResult, NfcCardStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export function normalizeUid(uid: string): string {
  const compact = uid.replace(/[:-]/g, '').replace(/\s/g, '').toUpperCase();
  if (!/^[0-9A-F]+$/.test(compact) || compact.length < 4 || compact.length % 2 !== 0) {
    throw new Error('Invalid NFC UID format');
  }
  return compact.match(/.{2}/g)!.join(':');
}

export type NfcAuthenticationResult = {
  result: AccessResult;
  reason: AccessReason;
  employeeId: string | null;
  nfcCardId: string | null;
  uid: string;
};

export async function authenticateNfcUid(uid: string, binId?: string): Promise<NfcAuthenticationResult> {
  let normalizedUid: string;
  try {
    normalizedUid = normalizeUid(uid);
  } catch {
    return { result: AccessResult.DENIED, reason: AccessReason.UNKNOWN_CARD, employeeId: null, nfcCardId: null, uid: uid.toUpperCase() };
  }

  const card = await prisma.nfcCard.findUnique({ include: { employee: true }, where: { uid: normalizedUid } });
  let result: AccessResult = AccessResult.DENIED;
  let reason: AccessReason = AccessReason.UNKNOWN_CARD;
  if (card?.status === NfcCardStatus.ACTIVE && card.employee.status === 'ACTIVE') {
    result = AccessResult.ALLOWED;
    reason = AccessReason.VALID_CARD;
  } else if (card?.status === NfcCardStatus.REVOKED) reason = AccessReason.REVOKED_CARD;
  else if (card?.status === NfcCardStatus.LOST) reason = AccessReason.LOST_CARD;
  else if (card?.status === NfcCardStatus.EXPIRED) reason = AccessReason.EXPIRED_CARD;
  else if (card) reason = AccessReason.INACTIVE_EMPLOYEE;

  const bin = binId ? await prisma.bin.findFirst({ where: { OR: [{ id: binId }, { binCode: binId }] } }) : null;
  await prisma.accessLog.create({ data: { employeeId: card?.employeeId ?? null, nfcCardId: card?.id ?? null, binId: bin?.id ?? null, nfcUid: normalizedUid, action: 'AUTHENTICATE', result, reason } });
  return { result, reason, employeeId: card?.employeeId ?? null, nfcCardId: card?.id ?? null, uid: normalizedUid };
}
