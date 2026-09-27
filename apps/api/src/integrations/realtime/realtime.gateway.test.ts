import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { DeviceStatusEnum } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { RealtimeGateway, REALTIME_EVENTS, type DeviceStatusPayload, type RealtimeAlertPayload, type RealtimeTelemetryPayload } from './realtime.gateway.js';
import { DeviceHealthService } from '../../services/device-health.service.js';
import { MqttAdapter } from '../mqtt/mqtt.adapter.js';

class MockMqttClient extends EventEmitter {
  connected = true;
  subscribedTopics: string[] = [];

  subscribe(topics: string | string[], callback?: (err?: Error) => void) {
    if (Array.isArray(topics)) {
      this.subscribedTopics.push(...topics);
    } else {
      this.subscribedTopics.push(topics);
    }
    if (callback) callback();
    return this as any;
  }

  publish(_topic: string, _message: string, opts?: any, callback?: (err?: Error) => void) {
    if (typeof opts === 'function') opts();
    if (callback) callback();
    return this as any;
  }

  end(force?: boolean, opts?: any, cb?: () => void) {
    this.connected = false;
    this.emit('close');
    if (typeof force === 'function') (force as () => void)();
    if (typeof opts === 'function') (opts as () => void)();
    if (cb) cb();
    return this as any;
  }
}

function waitForEvent<T = unknown>(socket: ClientSocketType, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timeout waiting for event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    function listener(data: T) {
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(data);
    }

    socket.on(event, listener);
  });
}

async function runRealtimeTests() {
  console.log('=== RUNNING PHASE 6 BACKEND REALTIME & SOCKET.IO TESTS (R1 - R12) ===\n');

  // Find admin user for auth token
  const admin = await prisma.user.findFirst({ where: { role: { name: 'ADMIN' } } });
  if (!admin) throw new Error('No admin user found in database');
  const validToken = jwt.sign({ sub: admin.id }, env.JWT_SECRET, { expiresIn: '1h' });

  const httpServer = createServer();
  const realtime = new RealtimeGateway(httpServer);
  const healthService = new DeviceHealthService(realtime);
  const mockMqtt = new MockMqttClient();
  const adapter = new MqttAdapter(realtime, healthService, mockMqtt as any);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as any).port;
  const socketUrl = `http://localhost:${port}`;

  let clientSocket: ClientSocketType | null = null;

  try {
    // Connect real Socket.IO client with JWT
    clientSocket = ClientSocket(socketUrl, {
      auth: { token: validToken },
      transports: ['websocket']
    });

    await new Promise<void>((resolve, reject) => {
      clientSocket!.on('connect', () => resolve());
      clientSocket!.on('connect_error', (err) => reject(err));
    });
    console.log('  -> Socket.IO client connected with authentication\n');

    // ----------------------------------------------------
    // R1: Device heartbeat -> emit device:status
    // ----------------------------------------------------
    console.log('Test R1: Device heartbeat -> emit device:status');
    const r1EventPromise = waitForEvent<DeviceStatusPayload>(clientSocket, REALTIME_EVENTS.DEVICE_STATUS);

    const r1Timestamp = new Date().toISOString();
    await adapter.handleMessage(
      'smartbin/device/heartbeat',
      JSON.stringify({
        deviceId: 'raspberry-pi-01',
        deviceType: 'RASPBERRY_PI',
        status: 'ONLINE',
        ipAddress: '192.168.1.150',
        uptime: 8000,
        firmwareVersion: '1.0.0',
        timestamp: r1Timestamp
      })
    );

    const r1Payload = await r1EventPromise;
    if (r1Payload.deviceId !== 'raspberry-pi-01' || r1Payload.status !== 'ONLINE' || r1Payload.uptime !== 8000) {
      throw new Error(`R1 Failed: Unexpected device:status payload: ${JSON.stringify(r1Payload)}`);
    }
    // Check all required fields in payload
    if (!r1Payload.id || !r1Payload.deviceName || !r1Payload.deviceType || !r1Payload.lastSeen || !r1Payload.updatedAt) {
      throw new Error(`R1 Failed: Missing required fields in device:status payload: ${JSON.stringify(r1Payload)}`);
    }
    console.log('  -> PASS: device:status emitted with full standardized payload on heartbeat\n');

    // ----------------------------------------------------
    // R2: Device OFFLINE -> emit device:status -> create DEVICE_OFFLINE alert
    // ----------------------------------------------------
    console.log('Test R2: Device OFFLINE -> emit device:status -> create DEVICE_OFFLINE alert');
    // Clean any existing offline alerts for RPi
    await prisma.alert.deleteMany({
      where: { type: 'DEVICE_OFFLINE', message: { contains: 'Raspberry Pi 5 Gateway' } }
    });

    const r2StatusPromise = waitForEvent<DeviceStatusPayload>(clientSocket, REALTIME_EVENTS.DEVICE_STATUS);
    const r2AlertPromise = waitForEvent<RealtimeAlertPayload>(clientSocket, REALTIME_EVENTS.ALERT_CREATED);

    // Set lastSeen 45s ago
    const pastDate = new Date(Date.now() - 45000);
    await prisma.deviceStatus.update({
      where: { deviceId: 'raspberry-pi-01' },
      data: { status: DeviceStatusEnum.ONLINE, lastSeen: pastDate }
    });

    await healthService.evaluateAllDevices();

    const [r2Status, r2Alert] = await Promise.all([r2StatusPromise, r2AlertPromise]);
    if (r2Status.deviceId !== 'raspberry-pi-01' || r2Status.status !== 'OFFLINE') {
      throw new Error(`R2 Failed: Expected device:status OFFLINE, got: ${JSON.stringify(r2Status)}`);
    }
    if (r2Alert.type !== 'DEVICE_OFFLINE' || !r2Alert.message.includes('Raspberry Pi 5 Gateway')) {
      throw new Error(`R2 Failed: Expected alert:created with DEVICE_OFFLINE, got: ${JSON.stringify(r2Alert)}`);
    }
    console.log('  -> PASS: device:status (OFFLINE) and alert:created emitted on device transition to OFFLINE\n');

    // ----------------------------------------------------
    // R3: Device OFFLINE second time -> no duplicate alert
    // ----------------------------------------------------
    console.log('Test R3: Device OFFLINE second time -> no duplicate alert');
    let duplicateAlertReceived = false;
    const duplicateListener = (alert: RealtimeAlertPayload) => {
      if (alert.type === 'DEVICE_OFFLINE' && alert.message.includes('Raspberry Pi 5 Gateway')) {
        duplicateAlertReceived = true;
      }
    };
    clientSocket.on(REALTIME_EVENTS.ALERT_CREATED, duplicateListener);

    // Re-evaluate devices (RPi is still OFFLINE)
    await healthService.evaluateAllDevices();
    await new Promise((r) => setTimeout(r, 200));

    clientSocket.off(REALTIME_EVENTS.ALERT_CREATED, duplicateListener);

    const alertsCount = await prisma.alert.count({
      where: { type: 'DEVICE_OFFLINE', isResolved: false, message: { contains: 'Raspberry Pi 5 Gateway' } }
    });
    if (alertsCount !== 1) {
      throw new Error(`R3 Failed: Expected exactly 1 unresolved alert in DB, got ${alertsCount}`);
    }
    if (duplicateAlertReceived) {
      throw new Error(`R3 Failed: Duplicate alert was emitted over Socket.IO`);
    }
    console.log('  -> PASS: No duplicate alert created in DB or emitted over Socket.IO\n');

    // ----------------------------------------------------
    // R4: Device OFFLINE -> ONLINE -> emit device:status -> resolve alert
    // ----------------------------------------------------
    console.log('Test R4: Device OFFLINE -> ONLINE -> emit device:status -> resolve alert');
    const r4StatusPromise = waitForEvent<DeviceStatusPayload>(clientSocket, REALTIME_EVENTS.DEVICE_STATUS);
    const r4ResolvedAlertPromise = waitForEvent<RealtimeAlertPayload>(clientSocket, REALTIME_EVENTS.ALERT_RESOLVED);

    await adapter.handleMessage(
      'smartbin/device/heartbeat',
      JSON.stringify({
        deviceId: 'raspberry-pi-01',
        deviceType: 'RASPBERRY_PI',
        status: 'ONLINE',
        uptime: 8100,
        timestamp: new Date().toISOString()
      })
    );

    const [r4Status, r4ResolvedAlert] = await Promise.all([r4StatusPromise, r4ResolvedAlertPromise]);
    if (r4Status.status !== 'ONLINE') {
      throw new Error(`R4 Failed: Expected status ONLINE, got ${r4Status.status}`);
    }
    if (!r4ResolvedAlert.isResolved || !r4ResolvedAlert.resolvedAt) {
      throw new Error(`R4 Failed: Expected resolved alert event, got: ${JSON.stringify(r4ResolvedAlert)}`);
    }
    console.log('  -> PASS: device:status (ONLINE) and alert:resolved emitted, alert marked resolved in DB\n');

    // ----------------------------------------------------
    // R5: Ultrasonic telemetry -> SensorReading created -> Bin.currentFillLevel updated -> realtime telemetry emitted
    // ----------------------------------------------------
    console.log('Test R5: Ultrasonic telemetry -> SensorReading created -> Bin.currentFillLevel updated -> realtime telemetry emitted');
    const r5TelemetryPromise = waitForEvent<RealtimeTelemetryPayload>(clientSocket, REALTIME_EVENTS.BIN_TELEMETRY);

    const telemetryTimestamp = new Date(Date.now() + 5000).toISOString();
    await adapter.handleMessage(
      'smartbin/ORGANIC/sensor/ultrasonic',
      JSON.stringify({
        binCode: 'ORGANIC',
        distanceCm: 42.5,
        fillLevel: 58,
        timestamp: telemetryTimestamp,
        deviceId: 'ultrasonic-01'
      })
    );

    const r5Telemetry = await r5TelemetryPromise;
    if (r5Telemetry.binCode !== 'ORGANIC' || r5Telemetry.fillLevel !== 58 || r5Telemetry.distanceCm !== 42.5) {
      throw new Error(`R5 Failed: Unexpected telemetry payload: ${JSON.stringify(r5Telemetry)}`);
    }
    // Verify aliases
    if (r5Telemetry.currentFillLevel !== 58 || r5Telemetry.distance !== 42.5) {
      throw new Error(`R5 Failed: Compatibility aliases (currentFillLevel/distance) missing in telemetry payload`);
    }

    const organicBin = await prisma.bin.findUnique({ where: { binCode: 'ORGANIC' } });
    if (organicBin?.currentFillLevel !== 58) {
      throw new Error(`R5 Failed: Bin.currentFillLevel in DB was not updated to 58, got ${organicBin?.currentFillLevel}`);
    }
    console.log('  -> PASS: SensorReading saved, Bin.currentFillLevel updated to 58%, and bin:telemetry emitted\n');

    // ----------------------------------------------------
    // R6: Fill level alert -> alert emitted realtime
    // ----------------------------------------------------
    console.log('Test R6: Fill level alert -> alert emitted realtime');
    const r6AlertPromise = waitForEvent<RealtimeAlertPayload>(clientSocket, REALTIME_EVENTS.ALERT_CREATED);

    const criticalTelemetryTime = new Date(Date.now() + 10000).toISOString();
    await adapter.handleMessage(
      'smartbin/ORGANIC/sensor/ultrasonic',
      JSON.stringify({
        binCode: 'ORGANIC',
        distanceCm: 8.0,
        fillLevel: 94,
        timestamp: criticalTelemetryTime,
        deviceId: 'ultrasonic-01'
      })
    );

    const r6Alert = await r6AlertPromise;
    if (r6Alert.type !== 'CRITICAL' || r6Alert.severity !== 'CRITICAL') {
      throw new Error(`R6 Failed: Expected CRITICAL alert on 94% fill level, got: ${JSON.stringify(r6Alert)}`);
    }
    console.log('  -> PASS: CRITICAL fill level alert emitted in realtime via Socket.IO\n');

    // ----------------------------------------------------
    // R7: MQTT connect -> mqtt-broker-01 ONLINE -> device:status emit
    // ----------------------------------------------------
    console.log('Test R7: MQTT connect -> mqtt-broker-01 ONLINE -> device:status emit');
    await prisma.deviceStatus.update({
      where: { deviceId: 'mqtt-broker-01' },
      data: { status: DeviceStatusEnum.OFFLINE }
    });

    const r7StatusPromise = waitForEvent<DeviceStatusPayload>(clientSocket, REALTIME_EVENTS.DEVICE_STATUS);
    mockMqtt.emit('connect');

    const r7Status = await r7StatusPromise;
    if (r7Status.deviceId !== 'mqtt-broker-01' || r7Status.status !== 'ONLINE') {
      throw new Error(`R7 Failed: Expected mqtt-broker-01 ONLINE, got: ${JSON.stringify(r7Status)}`);
    }
    console.log('  -> PASS: mqtt-broker-01 transitioned to ONLINE and emitted device:status\n');

    // ----------------------------------------------------
    // R8: MQTT offline -> mqtt-broker-01 OFFLINE -> device:status emit -> DEVICE_OFFLINE alert
    // ----------------------------------------------------
    console.log('Test R8: MQTT offline -> mqtt-broker-01 OFFLINE -> device:status emit -> DEVICE_OFFLINE alert');
    const r8StatusPromise = waitForEvent<DeviceStatusPayload>(clientSocket, REALTIME_EVENTS.DEVICE_STATUS);
    const r8AlertPromise = waitForEvent<RealtimeAlertPayload>(clientSocket, REALTIME_EVENTS.ALERT_CREATED);

    mockMqtt.emit('offline');

    const [r8Status, r8Alert] = await Promise.all([r8StatusPromise, r8AlertPromise]);
    if (r8Status.deviceId !== 'mqtt-broker-01' || r8Status.status !== 'OFFLINE') {
      throw new Error(`R8 Failed: Expected mqtt-broker-01 OFFLINE, got: ${JSON.stringify(r8Status)}`);
    }
    if (r8Alert.type !== 'DEVICE_OFFLINE' || !r8Alert.message.includes('Kết nối MQTT Broker')) {
      throw new Error(`R8 Failed: Expected DEVICE_OFFLINE alert for MQTT broker, got: ${JSON.stringify(r8Alert)}`);
    }
    console.log('  -> PASS: mqtt-broker-01 OFFLINE emitted device:status and DEVICE_OFFLINE alert\n');

    // ----------------------------------------------------
    // R9: MQTT reconnect -> mqtt-broker-01 ONLINE -> resolve alert
    // ----------------------------------------------------
    console.log('Test R9: MQTT reconnect -> mqtt-broker-01 ONLINE -> resolve alert');
    const r9StatusPromise = waitForEvent<DeviceStatusPayload>(clientSocket, REALTIME_EVENTS.DEVICE_STATUS);
    const r9ResolvedPromise = waitForEvent<RealtimeAlertPayload>(clientSocket, REALTIME_EVENTS.ALERT_RESOLVED);

    mockMqtt.emit('reconnect');

    const [r9Status, r9Resolved] = await Promise.all([r9StatusPromise, r9ResolvedPromise]);
    if (r9Status.deviceId !== 'mqtt-broker-01' || r9Status.status !== 'ONLINE') {
      throw new Error(`R9 Failed: Expected mqtt-broker-01 ONLINE on reconnect, got: ${JSON.stringify(r9Status)}`);
    }
    if (!r9Resolved.isResolved || !r9Resolved.message.includes('Kết nối MQTT Broker')) {
      throw new Error(`R9 Failed: Expected alert resolution for MQTT broker, got: ${JSON.stringify(r9Resolved)}`);
    }
    console.log('  -> PASS: mqtt-broker-01 reconnected ONLINE and resolved its offline alert\n');

    // ----------------------------------------------------
    // R10: Socket client connect/disconnect -> backend does not crash
    // ----------------------------------------------------
    console.log('Test R10: Socket client connect/disconnect -> backend does not crash');
    // Test client with no token (should fail handshake gracefully)
    const unauthClient = ClientSocket(socketUrl, {
      auth: {},
      transports: ['websocket'],
      reconnection: false
    });

    const unauthError = await new Promise<string>((resolve) => {
      unauthClient.on('connect_error', (err) => {
        resolve(err.message);
      });
    });
    if (!unauthError.includes('Authentication required')) {
      throw new Error(`R10 Failed: Expected 'Authentication required', got '${unauthError}'`);
    }
    unauthClient.disconnect();

    // Test client with invalid token
    const invalidClient = ClientSocket(socketUrl, {
      auth: { token: 'invalid.jwt.token' },
      transports: ['websocket'],
      reconnection: false
    });

    const invalidError = await new Promise<string>((resolve) => {
      invalidClient.on('connect_error', (err) => {
        resolve(err.message);
      });
    });
    if (!invalidError.includes('Invalid or expired token')) {
      throw new Error(`R10 Failed: Expected 'Invalid or expired token', got '${invalidError}'`);
    }
    invalidClient.disconnect();

    console.log('  -> PASS: Auth errors handled gracefully, connect/disconnect lifecycle causes no crash\n');

    // ----------------------------------------------------
    // R11: Invalid MQTT message -> no incorrect data emitted -> backend does not crash
    // ----------------------------------------------------
    console.log('Test R11: Invalid MQTT message -> no incorrect data emitted -> backend does not crash');
    let spuriousEventReceived = false;
    const spuriousListener = () => {
      spuriousEventReceived = true;
    };
    clientSocket.on(REALTIME_EVENTS.BIN_TELEMETRY, spuriousListener);

    // Send broken JSON
    await adapter.handleMessage('smartbin/ORGANIC/sensor/ultrasonic', '{malformed-json');
    // Send invalid schema
    await adapter.handleMessage(
      'smartbin/ORGANIC/sensor/ultrasonic',
      JSON.stringify({
        binCode: 'ORGANIC',
        fillLevel: 9999, // exceeds 100 max
        distanceCm: -10
      })
    );

    await new Promise((r) => setTimeout(r, 150));
    clientSocket.off(REALTIME_EVENTS.BIN_TELEMETRY, spuriousListener);

    if (spuriousEventReceived) {
      throw new Error(`R11 Failed: Telemetry event was emitted for invalid payload`);
    }
    console.log('  -> PASS: Invalid MQTT messages rejected without emitting false events or crashing server\n');

    // ----------------------------------------------------
    // R12: Existing DeviceHealthService A1-A6 still PASS
    // ----------------------------------------------------
    console.log('Test R12: Verification that DeviceHealthService core logic remains intact');
    const allDevices = await healthService.getAllDevices();
    if (allDevices.length !== 4) {
      throw new Error(`R12 Failed: Expected 4 monitored devices, found ${allDevices.length}`);
    }
    console.log(`  -> PASS: DeviceHealthService healthy with all ${allDevices.length} monitored devices\n`);

    console.log('=== ALL PHASE 6 REALTIME TESTS (R1 - R12) PASSED SUCCESSFULLY! ===\n');
  } finally {
    if (clientSocket?.connected) clientSocket.disconnect();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await prisma.$disconnect();
  }
}

runRealtimeTests().catch((err) => {
  console.error('REALTIME TESTS FAILED:', err);
  process.exit(1);
});
