import bcrypt from 'bcrypt';
import { PrismaClient, RoleName, BinStatus, StationStatus, CollectionStatus, AlertType, AlertSeverity, DeviceType, DeviceStatusEnum } from '@prisma/client';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient();

async function main() {
  await prisma.alert.deleteMany();
  await prisma.collectionRecord.deleteMany();
  await prisma.sensorReading.deleteMany();
  await prisma.deviceStatus.deleteMany();
  await prisma.user.deleteMany();
  await prisma.bin.deleteMany();
  await prisma.stationWatermark.deleteMany();
  await prisma.telemetryIdempotencyLedger.deleteMany();
  await prisma.station.deleteMany();
  await prisma.role.deleteMany();

  const roles = await Promise.all([
    prisma.role.create({ data: { name: RoleName.ADMIN, description: 'Full system access' } }),
    prisma.role.create({ data: { name: RoleName.SUPERVISOR, description: 'Operations monitoring access' } }),
    prisma.role.create({ data: { name: RoleName.WORKER, description: 'Collection task access' } })
  ]);
  const roleMap = new Map(roles.map((role) => [role.name, role.id]));

  const passwords = [env.SEED_ADMIN_PASSWORD, env.SEED_SUPERVISOR_PASSWORD, env.SEED_WORKER_PASSWORD];
  const userPresets = [
    { username: 'admin', displayName: 'Nguyen Minh An', role: RoleName.ADMIN },
    { username: 'supervisor', displayName: 'Tran Thu Ha', role: RoleName.SUPERVISOR },
    { username: 'worker', displayName: 'Le Van Binh', role: RoleName.WORKER }
  ];

  for (const [index, item] of userPresets.entries()) {
    await prisma.user.create({
      data: {
        username: item.username,
        displayName: item.displayName,
        passwordHash: await bcrypt.hash(passwords[index], 12),
        roleId: roleMap.get(item.role)!
      }
    });
  }

  const now = new Date();

  // Seed 4 monitored IoT devices
  await prisma.deviceStatus.createMany({
    data: [
      {
        deviceId: 'raspberry-pi-5',
        deviceName: 'Raspberry Pi 5 Gateway',
        deviceType: DeviceType.RASPBERRY_PI,
        status: DeviceStatusEnum.ONLINE,
        lastSeen: now,
        lastHeartbeat: now,
        uptime: 3600,
        firmwareVersion: '1.0.0'
      },
      {
        deviceId: 'ultrasonic-01',
        deviceName: 'Cảm biến siêu âm',
        deviceType: DeviceType.ULTRASONIC_SENSOR,
        status: DeviceStatusEnum.ONLINE,
        lastSeen: now,
        lastHeartbeat: now,
        metadata: JSON.stringify({ distanceCm: 22, fillLevel: 78 })
      },
      {
        deviceId: 'camera-01',
        deviceName: 'Camera AI',
        deviceType: DeviceType.CAMERA,
        status: DeviceStatusEnum.ONLINE,
        lastSeen: now,
        lastHeartbeat: now,
        metadata: JSON.stringify({ aiModel: 'YOLOv8-Waste', confidence: 0.94 })
      },
      {
        deviceId: 'mqtt-broker-01',
        deviceName: 'Kết nối MQTT Broker',
        deviceType: DeviceType.MQTT,
        status: DeviceStatusEnum.ONLINE,
        lastSeen: now,
        metadata: JSON.stringify({ broker: env.MQTT_BROKER_URL || 'mqtt://localhost:1883' })
      }
    ]
  });

  // 1. Khởi tạo Trạm A và Trạm B
  const stationA = await prisma.station.upsert({
    where: { code: 'STATION_A' },
    create: {
      id: 'station_a_canonical_id',
      code: 'STATION_A',
      name: 'Trạm Thu gom Trung tâm A',
      status: StationStatus.ONLINE,
      isActive: true,
      location: 'Khuôn viên chính'
    },
    update: {}
  });

  const stationB = await prisma.station.upsert({
    where: { code: 'STATION_B' },
    create: {
      id: 'station_b_canonical_id',
      code: 'STATION_B',
      name: 'Trạm Thu gom Mở rộng B',
      status: StationStatus.OFFLINE,
      isActive: false,
      location: 'Khuôn viên phía Đông'
    },
    update: {}
  });

  // 2. Khởi tạo các ngăn rác Trạm A (Đầy đủ 3 ngăn hoạt động)
  const stationABins = [
    { stationId: stationA.id, binCode: 'ORGANIC', name: 'Rác hữu cơ', location: 'Ngăn rác hữu cơ Trạm A', capacity: 240, currentFillLevel: 25, status: BinStatus.ONLINE, installed: true, lastSeen: now },
    { stationId: stationA.id, binCode: 'RECYCLABLE', name: 'Rác tái chế', location: 'Ngăn rác tái chế Trạm A', capacity: 240, currentFillLevel: 58, status: BinStatus.ONLINE, installed: true, lastSeen: now },
    { stationId: stationA.id, binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế', location: 'Ngăn rác không tái chế Trạm A', capacity: 360, currentFillLevel: 78, status: BinStatus.ONLINE, installed: true, lastSeen: now }
  ];
  const binsA = await Promise.all(stationABins.map((bin) => prisma.bin.create({ data: bin })));

  // 3. Khởi tạo các ngăn rác Trạm B (Chỉ có RECYCLABLE được lắp; NON_RECYCLABLE và ORGANIC là NOT_INSTALLED)
  const stationBBins = [
    { stationId: stationB.id, binCode: 'RECYCLABLE', name: 'Rác tái chế Trạm B', location: 'Ngăn rác tái chế Trạm B', capacity: 240, currentFillLevel: 0, status: BinStatus.OFFLINE, installed: true, lastSeen: null },
    { stationId: stationB.id, binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế Trạm B', location: 'Ngăn rác không tái chế Trạm B', capacity: 360, currentFillLevel: null, status: BinStatus.MAINTENANCE, installed: false, lastSeen: null },
    { stationId: stationB.id, binCode: 'ORGANIC', name: 'Rác hữu cơ Trạm B', location: 'Ngăn rác hữu cơ Trạm B', capacity: 240, currentFillLevel: null, status: BinStatus.MAINTENANCE, installed: false, lastSeen: null }
  ];
  await Promise.all(stationBBins.map((bin) => prisma.bin.create({ data: bin })));

  // 4. Khởi tạo dữ liệu đo cảm biến cho các ngăn đã lắp đặt của Trạm A
  for (const [index, bin] of binsA.entries()) {
    if (bin.currentFillLevel !== null && bin.installed) {
      const fill = bin.currentFillLevel;
      await prisma.sensorReading.createMany({
        data: [
          { binId: bin.id, distance: [75, 42, 22][index], fillLevel: fill, timestamp: new Date(now.getTime() - 1000 * 60 * 20), isLate: false },
          { binId: bin.id, distance: [68, 36, 18][index], fillLevel: Math.max(0, fill - 8), timestamp: new Date(now.getTime() - 1000 * 60 * 10), isLate: false },
          { binId: bin.id, distance: [75, 42, 22][index], fillLevel: fill, timestamp: now, isLate: false }
        ]
      });
    }
  }

  await prisma.collectionRecord.create({
    data: {
      binId: binsA[2].id,
      collectedBy: 'Le Van Binh',
      collectedAt: new Date(now.getTime() - 1000 * 60 * 30),
      fillLevelBefore: 82,
      fillLevelAfter: 16,
      status: CollectionStatus.COMPLETED,
      notes: 'Lịch sử thu gom demo cho ngăn rác không tái chế'
    }
  });

  await prisma.alert.createMany({
    data: [
      { binId: binsA[1].id, type: AlertType.NEARLY_FULL, severity: AlertSeverity.WARNING, message: 'Ngăn rác tái chế đang ở mức cảnh báo' },
      { binId: binsA[2].id, type: AlertType.CRITICAL, severity: AlertSeverity.CRITICAL, message: 'Ngăn rác không tái chế cần thu gom ngay' }
    ]
  });

  console.log('Seed completed: 2 Stations (A & B), 3 users, 4 IoT devices, 6 SmartBin compartments (Station B configured with only Recyclable installed).');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());