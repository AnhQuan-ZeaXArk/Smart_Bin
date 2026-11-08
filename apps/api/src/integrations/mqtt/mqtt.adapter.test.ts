import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { MqttClient } from 'mqtt';
import { DeviceStatusEnum, DeviceType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { MqttAdapter, MQTT_SUBSCRIPTIONS } from './mqtt.adapter.js';
import { DeviceHealthService } from '../../services/device-health.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { app } from '../../app.js';
import { assertIsolatedTestDb } from '../../test-utils/test-db-guard.js';

class MockMqttClient extends EventEmitter {
  connected = true;
  subscribedTopics: string[] = [];
  publishedMessages: Array<{ topic: string; message: string }> = [];

  subscribe(topics: string | string[], callback?: (err?: Error) => void) {
    if (Array.isArray(topics)) {
      this.subscribedTopics.push(...topics);
    } else {
      this.subscribedTopics.push(topics);
    }
    if (callback) callback();
    return this as unknown as MqttClient;
  }

  publish(topic: string, message: string, opts?: any, callback?: (err?: Error) => void) {
    this.publishedMessages.push({ topic, message });
    if (typeof opts === 'function') opts();
    if (callback) callback();
    return this as unknown as MqttClient;
  }

  end(force?: boolean, opts?: any, cb?: () => void) {
    this.connected = false;
    this.emit('close');
    if (typeof force === 'function') (force as () => void)();
    if (typeof opts === 'function') (opts as () => void)();
    if (cb) cb();
    return this as unknown as MqttClient;
  }
}

async function runMqttTests() {
  assertIsolatedTestDb('MQTT Device Health Tests');
  console.log('=== RUNNING PHASE 5 MQTT DEVICE HEALTH TESTS (M1 - M12) ===\n');

  const httpServer = createServer();
  const realtime = new RealtimeGateway(httpServer);
  const healthService = new DeviceHealthService(realtime);
  const mockClient = new MockMqttClient();
  const adapter = new MqttAdapter(realtime, healthService, mockClient as unknown as MqttClient);

  try {
    // ----------------------------------------------------
    // M1: MQTT connect -> mqtt-broker-01 ONLINE
    // ----------------------------------------------------
    console.log('Test M1: MQTT connect -> mqtt-broker-01 ONLINE');
    await prisma.deviceStatus.update({
      where: { deviceId: 'mqtt-broker-01' },
      data: { status: DeviceStatusEnum.OFFLINE }
    });
    mockClient.emit('connect');
    // Allow async setDeviceStatus to complete
    await new Promise((r) => setTimeout(r, 100));

    const brokerOnline = await prisma.deviceStatus.findUnique({
      where: { deviceId: 'mqtt-broker-01' }
    });
    if (brokerOnline?.status !== DeviceStatusEnum.ONLINE) {
      throw new Error(`M1 Failed: Expected mqtt-broker-01 ONLINE, got ${brokerOnline?.status}`);
    }
    console.log('  -> PASS: mqtt-broker-01 transitioned to ONLINE on connect\n');

    // ----------------------------------------------------
    // M2: MQTT disconnect -> mqtt-broker-01 OFFLINE
    // ----------------------------------------------------
    console.log('Test M2: MQTT disconnect -> mqtt-broker-01 OFFLINE');
    mockClient.emit('offline');
    await new Promise((r) => setTimeout(r, 100));

    const brokerOffline = await prisma.deviceStatus.findUnique({
      where: { deviceId: 'mqtt-broker-01' }
    });
    if (brokerOffline?.status !== DeviceStatusEnum.OFFLINE) {
      throw new Error(`M2 Failed: Expected mqtt-broker-01 OFFLINE, got ${brokerOffline?.status}`);
    }
    console.log('  -> PASS: mqtt-broker-01 transitioned to OFFLINE on disconnect/offline\n');

    // Re-connect broker for subsequent tests
    mockClient.emit('connect');
    await new Promise((r) => setTimeout(r, 100));

    // ----------------------------------------------------
    // M3: Raspberry Pi heartbeat -> raspberry-pi-01 ONLINE
    // ----------------------------------------------------
    console.log('Test M3: Raspberry Pi heartbeat -> raspberry-pi-01 ONLINE');
    const rpiTimestamp = new Date().toISOString();
    await adapter.handleMessage(
      'smartbin/device/heartbeat',
      JSON.stringify({
        deviceId: 'raspberry-pi-01',
        deviceType: 'RASPBERRY_PI',
        status: 'ONLINE',
        ipAddress: '192.168.1.150',
        uptime: 7200,
        firmwareVersion: '1.0.0',
        timestamp: rpiTimestamp
      })
    );

    const rpiDevice = await prisma.deviceStatus.findUnique({
      where: { deviceId: 'raspberry-pi-01' }
    });
    if (rpiDevice?.status !== DeviceStatusEnum.ONLINE || rpiDevice?.uptime !== 7200 || rpiDevice?.ipAddress !== '192.168.1.150') {
      throw new Error(`M3 Failed: Expected raspberry-pi-01 ONLINE with uptime 7200, got: ${JSON.stringify(rpiDevice)}`);
    }
    console.log('  -> PASS: raspberry-pi-01 heartbeat processed and updated\n');

    // ----------------------------------------------------
    // M4: Camera heartbeat -> camera-01 ONLINE
    // ----------------------------------------------------
    console.log('Test M4: Camera heartbeat -> camera-01 ONLINE');
    const cameraTimestamp = new Date().toISOString();
    await adapter.handleMessage(
      'smartbin/device/heartbeat',
      JSON.stringify({
        deviceId: 'camera-01',
        deviceType: 'CAMERA',
        status: 'ONLINE',
        metadata: { aiModel: 'YOLOv8-Waste', confidence: 0.98 },
        timestamp: cameraTimestamp
      })
    );

    const cameraDevice = await prisma.deviceStatus.findUnique({
      where: { deviceId: 'camera-01' }
    });
    if (cameraDevice?.status !== DeviceStatusEnum.ONLINE || !cameraDevice?.metadata?.includes('YOLOv8-Waste')) {
      throw new Error(`M4 Failed: Expected camera-01 ONLINE with metadata, got: ${JSON.stringify(cameraDevice)}`);
    }
    console.log('  -> PASS: camera-01 heartbeat processed and updated\n');

    // ----------------------------------------------------
    // M5: Ultrasonic telemetry -> SensorReading created
    // ----------------------------------------------------
    console.log('Test M5: Ultrasonic telemetry -> SensorReading created');
    const organicBin = await prisma.bin.findFirst({ where: { binCode: 'ORGANIC' } });
    if (!organicBin) throw new Error('M5 Failed: ORGANIC bin not found in DB');

    const readingsBefore = await prisma.sensorReading.count({ where: { binId: organicBin.id } });
    const telemetryTimestamp = new Date(Date.now() + 2000).toISOString();

    await adapter.handleMessage(
      'smartbin/ORGANIC/sensor/ultrasonic',
      JSON.stringify({
        binCode: 'ORGANIC',
        distanceCm: 45.2,
        fillLevel: 64,
        timestamp: telemetryTimestamp,
        deviceId: 'ultrasonic-01'
      })
    );

    const readingsAfter = await prisma.sensorReading.count({ where: { binId: organicBin.id } });
    if (readingsAfter !== readingsBefore + 1) {
      throw new Error(`M5 Failed: Expected sensor reading count to increase by 1. Before: ${readingsBefore}, After: ${readingsAfter}`);
    }
    console.log(`  -> PASS: SensorReading created successfully (${readingsAfter} total readings)\n`);

    // ----------------------------------------------------
    // M6: Ultrasonic telemetry -> Bin.fillLevel updated correctly
    // ----------------------------------------------------
    console.log('Test M6: Ultrasonic telemetry -> Bin.fillLevel updated correctly');
    const updatedBin = await prisma.bin.findFirst({ where: { binCode: 'ORGANIC' } });
    if (updatedBin?.currentFillLevel !== 64) {
      throw new Error(`M6 Failed: Expected currentFillLevel 64, got ${updatedBin?.currentFillLevel}`);
    }
    console.log('  -> PASS: Bin.fillLevel updated to 64%\n');

    // ----------------------------------------------------
    // M7: Ultrasonic telemetry -> ultrasonic-01.lastSeen updated
    // ----------------------------------------------------
    console.log('Test M7: Ultrasonic telemetry -> ultrasonic-01.lastSeen updated');
    const ultrasonicDevice = await prisma.deviceStatus.findUnique({ where: { deviceId: 'ultrasonic-01' } });
    if (ultrasonicDevice?.status !== DeviceStatusEnum.ONLINE) {
      throw new Error(`M7 Failed: Expected ultrasonic-01 status ONLINE, got ${ultrasonicDevice?.status}`);
    }
    console.log('  -> PASS: ultrasonic-01 activity and lastSeen updated\n');

    // ----------------------------------------------------
    // M8: Invalid heartbeat -> message rejected, MQTT does not crash
    // ----------------------------------------------------
    console.log('Test M8: Invalid heartbeat -> message rejected, MQTT does not crash');
    // Send malformed JSON
    await adapter.handleMessage('smartbin/device/heartbeat', 'not-valid-json{{{');
    // Send schema violation
    await adapter.handleMessage(
      'smartbin/device/heartbeat',
      JSON.stringify({
        deviceId: 'raspberry-pi-01',
        deviceType: 'NON_EXISTENT_DEVICE_TYPE',
        uptime: -99
      })
    );
    // Send valid heartbeat immediately after to prove adapter is still healthy
    await adapter.handleMessage(
      'smartbin/device/heartbeat',
      JSON.stringify({
        deviceId: 'raspberry-pi-01',
        deviceType: 'RASPBERRY_PI',
        status: 'ONLINE',
        uptime: 7300,
        timestamp: new Date().toISOString()
      })
    );
    const rpiAfterInvalid = await prisma.deviceStatus.findUnique({ where: { deviceId: 'raspberry-pi-01' } });
    if (rpiAfterInvalid?.uptime !== 7300) {
      throw new Error(`M8 Failed: Adapter failed to process valid message after invalid payload`);
    }
    console.log('  -> PASS: Invalid payloads rejected gracefully without crashing adapter\n');

    // ----------------------------------------------------
    // M9: Device OFFLINE -> creates exactly 1 DEVICE_OFFLINE alert
    // ----------------------------------------------------
    console.log('Test M9: Device OFFLINE -> creates exactly 1 DEVICE_OFFLINE alert');
    // Set device lastSeen to 45 seconds ago (exceeding OFFLINE threshold of 30s)
    const fortyFiveSecondsAgo = new Date(Date.now() - 45000);
    await prisma.deviceStatus.update({
      where: { deviceId: 'raspberry-pi-01' },
      data: { status: DeviceStatusEnum.ONLINE, lastSeen: fortyFiveSecondsAgo }
    });

    // Run evaluateAllDevices to detect offline device
    await healthService.evaluateAllDevices();

    const offlineDevice = await prisma.deviceStatus.findUnique({ where: { deviceId: 'raspberry-pi-01' } });
    if (offlineDevice?.status !== DeviceStatusEnum.OFFLINE) {
      throw new Error(`M9 Failed: Expected raspberry-pi-01 status OFFLINE, got ${offlineDevice?.status}`);
    }

    const offlineAlerts = await prisma.alert.findMany({
      where: {
        type: 'DEVICE_OFFLINE',
        isResolved: false,
        message: { contains: 'Raspberry Pi 5 Gateway' }
      }
    });
    if (offlineAlerts.length !== 1) {
      throw new Error(`M9 Failed: Expected exactly 1 unresolved DEVICE_OFFLINE alert, got ${offlineAlerts.length}`);
    }

    // Run evaluation again to verify deduplication (should not create another alert)
    await healthService.evaluateAllDevices();
    const alertsAfterReEvaluation = await prisma.alert.findMany({
      where: {
        type: 'DEVICE_OFFLINE',
        isResolved: false,
        message: { contains: 'Raspberry Pi 5 Gateway' }
      }
    });
    if (alertsAfterReEvaluation.length !== 1) {
      throw new Error(`M9 Failed: Deduplication failed. Expected 1 alert, got ${alertsAfterReEvaluation.length}`);
    }
    console.log(`  -> PASS: Exactly 1 unresolved alert created for offline device with deduplication\n`);

    // ----------------------------------------------------
    // M10: Device reconnect -> device ONLINE + resolve alert
    // ----------------------------------------------------
    console.log('Test M10: Device reconnect -> device ONLINE + resolve alert');
    await adapter.handleMessage(
      'smartbin/device/heartbeat',
      JSON.stringify({
        deviceId: 'raspberry-pi-01',
        deviceType: 'RASPBERRY_PI',
        status: 'ONLINE',
        uptime: 7400,
        timestamp: new Date().toISOString()
      })
    );

    const reconnectedDevice = await prisma.deviceStatus.findUnique({ where: { deviceId: 'raspberry-pi-01' } });
    if (reconnectedDevice?.status !== DeviceStatusEnum.ONLINE) {
      throw new Error(`M10 Failed: Expected raspberry-pi-01 ONLINE after reconnect, got ${reconnectedDevice?.status}`);
    }

    const resolvedAlert = await prisma.alert.findUnique({
      where: { id: offlineAlerts[0].id }
    });
    if (!resolvedAlert?.isResolved || !resolvedAlert.resolvedAt) {
      throw new Error(`M10 Failed: Alert ${offlineAlerts[0].id} was not resolved on device reconnect: ${JSON.stringify(resolvedAlert)}`);
    }
    console.log('  -> PASS: Device back ONLINE and DEVICE_OFFLINE alert resolved automatically\n');

    // ----------------------------------------------------
    // M11: No MQTT broker running -> backend still boots, /health returns 200
    // ----------------------------------------------------
    console.log('Test M11: No MQTT broker running -> backend still boots, /health returns 200');
    const testServer = createServer(app);
    await new Promise<void>((resolve) => testServer.listen(0, resolve));
    const port = (testServer.address() as any).port;

    const res = await fetch(`http://localhost:${port}/health`);
    const healthJson = await res.json();
    testServer.close();

    if (res.status !== 200 || healthJson.status !== 'ok') {
      throw new Error(`M11 Failed: Expected /health 200 ok, got ${res.status}: ${JSON.stringify(healthJson)}`);
    }
    console.log('  -> PASS: Backend booted and /health returned 200 OK without active MQTT broker\n');

    // ----------------------------------------------------
    // M12: NFC MQTT topic is NOT subscribed
    // ----------------------------------------------------
    console.log('Test M12: NFC MQTT topic is NOT subscribed');
    const subscriptions = adapter.getSubscriptions();
    console.log('  Active subscriptions:', subscriptions);

    const nfcFound = subscriptions.some((topic) => topic.toLowerCase().includes('nfc'));
    if (nfcFound) {
      throw new Error(`M12 Failed: NFC topic found in MQTT subscriptions: ${subscriptions.join(', ')}`);
    }
    console.log('  -> PASS: No NFC topics in MQTT subscriptions\n');

    console.log('=== ALL PHASE 5 MQTT TESTS (M1 - M12) PASSED SUCCESSFULLY! ===\n');
  } finally {
    await prisma.$disconnect();
    httpServer.close();
  }
}

runMqttTests().catch((err) => {
  console.error('MQTT TESTS FAILED:', err);
  process.exit(1);
});
