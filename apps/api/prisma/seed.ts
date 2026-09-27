import bcrypt from 'bcrypt';
import { PrismaClient, RoleName, BinStatus, CollectionStatus, AlertType, AlertSeverity, DeviceType, DeviceStatusEnum } from '@prisma/client';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient();

async function main() {
  await prisma.alert.deleteMany();
  await prisma.collectionRecord.deleteMany();
  await prisma.sensorReading.deleteMany();
  await prisma.deviceStatus.deleteMany();
  await prisma.user.deleteMany();
  await prisma.bin.deleteMany();
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
        deviceId: 'raspberry-pi-01',
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

  const sharedBins = [
    { binCode: 'ORGANIC', name: 'Rác hữu cơ', location: 'Ngăn rác hữu cơ', capacity: 240, currentFillLevel: 25, status: BinStatus.ONLINE, lastSeen: now },
    { binCode: 'RECYCLABLE', name: 'Rác tái chế', location: 'Ngăn rác tái chế', capacity: 240, currentFillLevel: 58, status: BinStatus.ONLINE, lastSeen: now },
    { binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế', location: 'Ngăn rác không tái chế', capacity: 360, currentFillLevel: 78, status: BinStatus.ONLINE, lastSeen: now }
  ];
  const bins = await Promise.all(sharedBins.map((bin) => prisma.bin.create({ data: bin })));

  for (const [index, bin] of bins.entries()) {
    await prisma.sensorReading.createMany({
      data: [
        { binId: bin.id, distance: [75, 42, 22][index], fillLevel: bin.currentFillLevel, timestamp: new Date(now.getTime() - 1000 * 60 * 20) },
        { binId: bin.id, distance: [68, 36, 18][index], fillLevel: Math.max(0, bin.currentFillLevel - 8), timestamp: new Date(now.getTime() - 1000 * 60 * 10) },
        { binId: bin.id, distance: [75, 42, 22][index], fillLevel: bin.currentFillLevel, timestamp: now }
      ]
    });
  }

  await prisma.collectionRecord.create({
    data: {
      binId: bins[2].id,
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
      { binId: bins[1].id, type: AlertType.NEARLY_FULL, severity: AlertSeverity.WARNING, message: 'Ngăn rác tái chế đang ở mức cảnh báo' },
      { binId: bins[2].id, type: AlertType.CRITICAL, severity: AlertSeverity.CRITICAL, message: 'Ngăn rác không tái chế cần thu gom ngay' }
    ]
  });

  console.log('Seed completed: 3 users, 4 IoT devices, 3 SmartBin compartments and collection record created.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());