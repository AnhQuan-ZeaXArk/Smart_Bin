import { DeviceStatusEnum, DeviceType, AlertType } from '@prisma/client';
import { DeviceHealthService, computeDeviceStatus } from './device-health.service.js';
import { DEVICE_HEALTH_CONFIG } from '../config/device-health.config.js';
import { prisma } from '../lib/prisma.js';

async function runTests() {
  console.log('=== STARTING DEVICE HEALTH SERVICE TESTS ===\n');

  const testDeviceId = 'test-rpi-unit-01';
  // Clean up any previous test device and alerts
  await prisma.deviceStatus.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.alert.deleteMany({ where: { message: { contains: 'Test RPi Unit' } } });

  const service = new DeviceHealthService();

  // Test A1: Device ONLINE on initial creation / heartbeat
  console.log('Test A1: Device ONLINE on initial registration / heartbeat');
  const now = new Date();
  const created = await service.recordHeartbeat({
    deviceId: testDeviceId,
    deviceName: 'Test RPi Unit',
    deviceType: DeviceType.RASPBERRY_PI,
    status: DeviceStatusEnum.ONLINE,
    ipAddress: '192.168.1.50',
    uptime: 120,
    firmwareVersion: '1.0.0',
    timestamp: now.toISOString()
  });

  if (created.status !== DeviceStatusEnum.ONLINE) {
    throw new Error(`A1 Failed: Expected status ONLINE, got ${created.status}`);
  }
  console.log('  -> PASS: Device created with status ONLINE\n');

  // Test A2: Heartbeat updates lastSeen
  console.log('Test A2: Heartbeat updates lastSeen and uptime');
  const later = new Date(now.getTime() + 5000);
  const updated = await service.recordHeartbeat({
    deviceId: testDeviceId,
    uptime: 125,
    timestamp: later.toISOString()
  });

  if (updated.lastSeen.getTime() !== later.getTime() || updated.uptime !== 125) {
    throw new Error(`A2 Failed: Expected lastSeen=${later.toISOString()} and uptime=125`);
  }
  console.log('  -> PASS: lastSeen and uptime updated successfully\n');

  // Test A3: WARNING status computation (15s <= lastSeen < 30s)
  console.log('Test A3: Status computes to WARNING when 15s <= lastSeen < 30s');
  const warningTime = new Date(Date.now() - 20_000); // 20s ago
  const warningStatus = computeDeviceStatus(warningTime);
  if (warningStatus !== DeviceStatusEnum.WARNING) {
    throw new Error(`A3 Failed: Expected WARNING for 20s elapsed, got ${warningStatus}`);
  }

  // Update DB device to 20s ago and evaluate
  await prisma.deviceStatus.update({
    where: { deviceId: testDeviceId },
    data: { lastSeen: warningTime, status: DeviceStatusEnum.ONLINE }
  });
  await service.evaluateAllDevices();
  const warningDevice = await prisma.deviceStatus.findUniqueOrThrow({ where: { deviceId: testDeviceId } });
  if (warningDevice.status !== DeviceStatusEnum.WARNING) {
    throw new Error(`A3 DB Failed: Expected device status in DB to be WARNING, got ${warningDevice.status}`);
  }
  console.log('  -> PASS: Device transitioned to WARNING\n');

  // Test A4: OFFLINE status computation (lastSeen >= 30s) and Alert creation
  console.log('Test A4: Status computes to OFFLINE when lastSeen >= 30s and creates Alert');
  const offlineTime = new Date(Date.now() - 35_000); // 35s ago
  const offlineStatus = computeDeviceStatus(offlineTime);
  if (offlineStatus !== DeviceStatusEnum.OFFLINE) {
    throw new Error(`A4 Failed: Expected OFFLINE for 35s elapsed, got ${offlineStatus}`);
  }

  // Update DB device to 35s ago and evaluate
  await prisma.deviceStatus.update({
    where: { deviceId: testDeviceId },
    data: { lastSeen: offlineTime }
  });
  await service.evaluateAllDevices();
  const offlineDevice = await prisma.deviceStatus.findUniqueOrThrow({ where: { deviceId: testDeviceId } });
  if (offlineDevice.status !== DeviceStatusEnum.OFFLINE) {
    throw new Error(`A4 DB Failed: Expected device status in DB to be OFFLINE, got ${offlineDevice.status}`);
  }

  // Check alert was created
  const alert = await prisma.alert.findFirst({
    where: {
      type: AlertType.DEVICE_OFFLINE,
      isResolved: false,
      message: { contains: 'Test RPi Unit' }
    }
  });
  if (!alert) {
    throw new Error('A4 Alert Failed: Expected DEVICE_OFFLINE alert to be created');
  }
  console.log(`  -> PASS: Device transitioned to OFFLINE and Alert created: "${alert.message}"\n`);

  // Test A6: Duplicate alert prevention
  console.log('Test A6: Duplicate alert prevention (evaluating again while OFFLINE does not create duplicate alerts)');
  await service.evaluateAllDevices();
  await service.evaluateAllDevices();
  const alertsCount = await prisma.alert.count({
    where: {
      type: AlertType.DEVICE_OFFLINE,
      isResolved: false,
      message: { contains: 'Test RPi Unit' }
    }
  });
  if (alertsCount !== 1) {
    throw new Error(`A6 Failed: Expected exactly 1 unresolved alert, but found ${alertsCount}`);
  }
  console.log(`  -> PASS: Exactly 1 alert exists (${alertsCount} alert found) - no duplicates!\n`);

  // Test A5: OFFLINE -> ONLINE recovery resolves alert
  console.log('Test A5: Device sends heartbeat -> recovers to ONLINE and resolves alert');
  const recoveryTime = new Date();
  const recoveredDevice = await service.recordHeartbeat({
    deviceId: testDeviceId,
    timestamp: recoveryTime.toISOString()
  });

  if (recoveredDevice.status !== DeviceStatusEnum.ONLINE) {
    throw new Error(`A5 Failed: Expected status ONLINE after recovery, got ${recoveredDevice.status}`);
  }

  const unresolvedAlerts = await prisma.alert.findMany({
    where: {
      type: AlertType.DEVICE_OFFLINE,
      isResolved: false,
      message: { contains: 'Test RPi Unit' }
    }
  });
  if (unresolvedAlerts.length !== 0) {
    throw new Error(`A5 Failed: Expected 0 unresolved alerts after recovery, found ${unresolvedAlerts.length}`);
  }

  const resolvedAlert = await prisma.alert.findFirst({
    where: {
      type: AlertType.DEVICE_OFFLINE,
      isResolved: true,
      message: { contains: 'Test RPi Unit' }
    }
  });
  if (!resolvedAlert || !resolvedAlert.resolvedAt) {
    throw new Error('A5 Failed: Alert was not marked as resolved with resolvedAt timestamp');
  }
  console.log('  -> PASS: Device recovered to ONLINE and Alert was resolved\n');

  // Clean up test data
  await prisma.deviceStatus.deleteMany({ where: { deviceId: testDeviceId } });
  await prisma.alert.deleteMany({ where: { message: { contains: 'Test RPi Unit' } } });

  console.log('=== ALL TESTS A1 - A6 PASSED CLEANLY! ===\n');
}

runTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
}).finally(() => {
  prisma.$disconnect();
});
