import bcrypt from 'bcrypt';
import { PrismaClient, RoleName, EmployeeStatus, NfcCardStatus, BinStatus, AccessResult, AccessReason, CollectionStatus, AlertType, AlertSeverity } from '@prisma/client';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient();

async function main() {
  await prisma.alert.deleteMany();
  await prisma.collectionRecord.deleteMany();
  await prisma.accessLog.deleteMany();
  await prisma.sensorReading.deleteMany();
  await prisma.nfcCard.deleteMany();
  await prisma.user.deleteMany();
  await prisma.bin.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.role.deleteMany();
  const roles = await Promise.all([
    prisma.role.create({ data: { name: RoleName.ADMIN, description: 'Full system access' } }),
    prisma.role.create({ data: { name: RoleName.SUPERVISOR, description: 'Operations monitoring access' } }),
    prisma.role.create({ data: { name: RoleName.WORKER, description: 'Collection task access' } })
  ]);
  const roleMap = new Map(roles.map((role) => [role.name, role.id]));
  const employees = await Promise.all([
    prisma.employee.create({ data: { employeeCode: 'NV001', fullName: 'Nguyen Minh An', phone: '0901000001', email: 'an@smartbin.local' } }),
    prisma.employee.create({ data: { employeeCode: 'NV002', fullName: 'Tran Thu Ha', phone: '0901000002', email: 'ha@smartbin.local' } }),
    prisma.employee.create({ data: { employeeCode: 'NV003', fullName: 'Le Van Binh', phone: '0901000003', email: 'binh@smartbin.local' } }),
    prisma.employee.create({ data: { employeeCode: 'NV004', fullName: 'Pham Ngoc Linh', phone: '0901000004', email: 'linh@smartbin.local', status: EmployeeStatus.INACTIVE } }),
    prisma.employee.create({ data: { employeeCode: 'NV005', fullName: 'Vo Quang Huy', phone: '0901000005', email: 'huy@smartbin.local' } })
  ]);
  const employeeMap = new Map(employees.map((employee) => [employee.employeeCode, employee]));
  const passwords = [env.SEED_ADMIN_PASSWORD, env.SEED_SUPERVISOR_PASSWORD, env.SEED_WORKER_PASSWORD];
  for (const [index, username] of ['admin', 'supervisor', 'worker'].entries()) {
    const role = [RoleName.ADMIN, RoleName.SUPERVISOR, RoleName.WORKER][index];
    await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash(passwords[index], 12), roleId: roleMap.get(role)!, employeeId: employeeMap.get(['NV001', 'NV002', 'NV003'][index])!.id } });
  }
  await prisma.nfcCard.createMany({ data: [
    { uid: '04:A1:B2:C3:D4:01', employeeId: employeeMap.get('NV001')!.id, status: NfcCardStatus.ACTIVE },
    { uid: '04:A1:B2:C3:D4:02', employeeId: employeeMap.get('NV002')!.id, status: NfcCardStatus.ACTIVE },
    { uid: '04:A1:B2:C3:D4:03', employeeId: employeeMap.get('NV003')!.id, status: NfcCardStatus.REVOKED },
    { uid: '04:A1:B2:C3:D4:04', employeeId: employeeMap.get('NV005')!.id, status: NfcCardStatus.LOST },
    { uid: '04:A1:B2:C3:D4:05', employeeId: employeeMap.get('NV004')!.id, status: NfcCardStatus.EXPIRED }
  ] });
  const now = new Date();
  const sharedBins = [
    { binCode: 'ORGANIC', name: 'Rác hữu cơ', location: 'Ngăn rác hữu cơ', capacity: 240, currentFillLevel: 25, status: BinStatus.ONLINE, lastSeen: now },
    { binCode: 'RECYCLABLE', name: 'Rác tái chế', location: 'Ngăn rác tái chế', capacity: 240, currentFillLevel: 58, status: BinStatus.ONLINE, lastSeen: now },
    { binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế', location: 'Ngăn rác không tái chế', capacity: 360, currentFillLevel: 78, status: BinStatus.ONLINE, lastSeen: now }
  ];
  const bins = await Promise.all(sharedBins.map((bin) => prisma.bin.create({ data: bin })));
  for (const [index, bin] of bins.entries()) await prisma.sensorReading.createMany({ data: [
    { binId: bin.id, distance: [75, 42, 22][index], fillLevel: bin.currentFillLevel, timestamp: new Date(now.getTime() - 1000 * 60 * 20) },
    { binId: bin.id, distance: [68, 36, 18][index], fillLevel: Math.max(0, bin.currentFillLevel - 8), timestamp: new Date(now.getTime() - 1000 * 60 * 10) },
    { binId: bin.id, distance: [75, 42, 22][index], fillLevel: bin.currentFillLevel, timestamp: now }
  ] });
  await prisma.accessLog.createMany({ data: [
    { employeeId: employeeMap.get('NV001')!.id, nfcCardId: (await prisma.nfcCard.findUniqueOrThrow({ where: { uid: '04:A1:B2:C3:D4:01' } })).id, binId: bins[0].id, nfcUid: '04:A1:B2:C3:D4:01', action: 'OPEN', result: AccessResult.ALLOWED, reason: AccessReason.VALID_CARD },
    { employeeId: null, nfcCardId: null, binId: bins[2].id, nfcUid: 'UNKNOWN:UID', action: 'OPEN', result: AccessResult.DENIED, reason: AccessReason.UNKNOWN_CARD }
  ] });
  await prisma.collectionRecord.create({ data: { binId: bins[2].id, employeeId: employeeMap.get('NV003')!.id, startTime: new Date(now.getTime() - 1000 * 60 * 30), endTime: now, fillLevelBefore: 82, fillLevelAfter: 16, status: CollectionStatus.COMPLETED, notes: 'Demo collection record for non-recyclable compartment' } });
  await prisma.alert.createMany({ data: [
    { binId: bins[1].id, type: AlertType.NEARLY_FULL, severity: AlertSeverity.WARNING, message: 'Ngăn rác tái chế đang ở mức cảnh báo' },
    { binId: bins[2].id, type: AlertType.CRITICAL, severity: AlertSeverity.CRITICAL, message: 'Ngăn rác không tái chế cần thu gom ngay' },
    { binId: bins[0].id, type: AlertType.NFC_ACCESS_DENIED, severity: AlertSeverity.INFO, message: 'Lần truy cập NFC không hợp lệ đã bị từ chối' }
  ] });
  console.log('Seed completed: 3 users, 5 employees, 5 cards, 3 SmartBin compartments and demo history created.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());