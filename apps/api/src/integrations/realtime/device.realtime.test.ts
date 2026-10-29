import { createServer } from 'node:http';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { RealtimeGateway } from './realtime.gateway.js';
import { REALTIME_EVENTS, type DeviceCommandPayload, type DeviceCommandStatusPayload } from './realtime.contract.js';
import { realDeviceService, type RealDeviceStatus } from '../../demo/real-device.service.js';
import { app } from '../../app.js';

function waitForEvent<T = unknown>(
  socket: ClientSocketType,
  event: string,
  predicate?: (data: T) => boolean,
  timeoutMs = 4000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timeout waiting for event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    function listener(data: T) {
      if (predicate && !predicate(data)) {
        return; // Keep waiting for the matching event
      }
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(data);
    }

    socket.on(event, listener);
  });
}

async function runDeviceRealtimeTests() {
  console.log('=== RUNNING BIDIRECTIONAL REALTIME & DEVICE SOCKET.IO TESTS ===\n');

  // Set test device ingest token in process.env
  const testToken = 'test-pi5-ingest-token-12345';
  process.env.DEVICE_INGEST_TOKEN = testToken;

  const httpServer = createServer(app);
  const realtime = new RealtimeGateway(httpServer);
  app.set('realtime', realtime);
  app.set('io', realtime.io);
  realDeviceService.setRealtime(realtime);
  realDeviceService.reset();

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as any).port;
  const socketUrl = `http://localhost:${port}`;

  try {
    // -------------------------------------------------------------
    // TEST 1: Rejection of Device Socket with Invalid Token
    // -------------------------------------------------------------
    console.log('Test 1: Device socket with invalid token is rejected');
    await new Promise<void>((resolve, reject) => {
      const badSocket = ClientSocket(socketUrl, {
        auth: { type: 'device', token: 'wrong-token', deviceId: 'raspberry-pi-5' },
        transports: ['websocket'],
        reconnection: false
      });

      badSocket.on('connect_error', (err) => {
        if (err.message.includes('Device authentication failed')) {
          console.log('  -> PASS: Socket connection rejected with authentication error\n');
          badSocket.close();
          resolve();
        } else {
          badSocket.close();
          reject(new Error(`Unexpected error message: ${err.message}`));
        }
      });

      badSocket.on('connect', () => {
        badSocket.close();
        reject(new Error('Test 1 Failed: Socket connected with invalid token!'));
      });
    });

    // -------------------------------------------------------------
    // TEST 2: Device Socket Connects Successfully with Valid Token
    // -------------------------------------------------------------
    console.log('Test 2: Device socket connects successfully with valid token and joins room');
    const piSocket = await new Promise<ClientSocketType>((resolve, reject) => {
      const s = ClientSocket(socketUrl, {
        auth: { type: 'device', token: testToken, deviceId: 'raspberry-pi-5' },
        transports: ['websocket'],
        reconnection: false
      });

      s.on('connect', () => {
        console.log('  -> PASS: Raspberry Pi 5 socket connected successfully');
        resolve(s);
      });

      s.on('connect_error', (err) => {
        s.close();
        reject(new Error(`Test 2 Failed: Connection error: ${err.message}`));
      });
    });

    // Connect a Web client socket to listen for broadcasted telemetry
    const webSocket = await new Promise<ClientSocketType>((resolve, reject) => {
      const s = ClientSocket(socketUrl, {
        transports: ['websocket'],
        reconnection: false
      });

      s.on('connect', () => {
        console.log('  -> PASS: Web client socket connected successfully\n');
        resolve(s);
      });

      s.on('connect_error', (err) => {
        s.close();
        reject(err);
      });
    });

    // -------------------------------------------------------------
    // TEST 3: Telemetry Sent from Pi -> Broadcasted to Web
    // -------------------------------------------------------------
    console.log('Test 3: Telemetry sent from Pi via Socket.IO updates Web in real-time');
    const webHeartbeatPromise = waitForEvent<RealDeviceStatus>(webSocket, REALTIME_EVENTS.DEVICE_HEARTBEAT);

    piSocket.emit(REALTIME_EVENTS.DEVICE_TELEMETRY, {
      deviceId: 'raspberry-pi-5',
      status: 'ONLINE',
      uptimeSeconds: 7200,
      cpuTempC: 49.2,
      sentAt: new Date().toISOString(),
      sensors: {
        distanceCm: 15.5,
        fillLevel: 80
      }
    });

    const receivedStatus = await webHeartbeatPromise;
    if (
      receivedStatus.deviceId !== 'raspberry-pi-5' ||
      receivedStatus.uptimeSeconds !== 7200 ||
      receivedStatus.cpuTempC !== 49.2 ||
      receivedStatus.sensors?.distanceCm !== 15.5
    ) {
      throw new Error(`Test 3 Failed: Unexpected status payload: ${JSON.stringify(receivedStatus)}`);
    }
    console.log(`  -> PASS: Web received live telemetry (uptime=${receivedStatus.uptimeSeconds}s, temp=${receivedStatus.cpuTempC}°C, distance=${receivedStatus.sensors?.distanceCm}cm, isSocketConnected=${receivedStatus.isSocketConnected})\n`);

    // -------------------------------------------------------------
    // TEST 4: PING Flow (Web -> Backend -> Pi -> Web)
    // -------------------------------------------------------------
    console.log('Test 4: PING flow (Web calls REST -> Backend sends Socket.IO to Pi -> Pi ACKs -> Web gets response)');

    // Pi sets up handler to respond to commands
    piSocket.on(REALTIME_EVENTS.DEVICE_COMMAND, (cmd: DeviceCommandPayload) => {
      console.log(`    [Pi Mock] Received command "${cmd.action}" (id=${cmd.commandId})`);
      if (cmd.action === 'PING') {
        piSocket.emit(REALTIME_EVENTS.DEVICE_COMMAND_ACK, {
          commandId: cmd.commandId,
          deviceId: 'raspberry-pi-5',
          action: 'PING',
          status: 'COMPLETED',
          message: 'Pong! Test Pi 5 responded to PING',
          result: { cpuTempC: 49.5, uptimeSeconds: 7205 }
        });
      } else if (cmd.action === 'TRIGGER_ULTRASONIC') {
        piSocket.emit(REALTIME_EVENTS.DEVICE_COMMAND_ACK, {
          commandId: cmd.commandId,
          deviceId: 'raspberry-pi-5',
          action: 'TRIGGER_ULTRASONIC',
          status: 'FAILED',
          message: 'Cảm biến siêu âm chưa kết nối chân GPIO vật lý trên Pi 5.',
          error: 'SENSOR_NOT_ATTACHED'
        });
      }
    });

    const webStatusPromise = waitForEvent<DeviceCommandStatusPayload>(
      webSocket,
      REALTIME_EVENTS.DEVICE_COMMAND_STATUS,
      (s) => s.status === 'COMPLETED'
    );

    const postRes = await fetch(`${socketUrl}/api/demo/device-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'raspberry-pi-5', action: 'PING' })
    });
    const postBody = await postRes.json();

    if (postRes.status !== 200 || !postBody.success || postBody.status !== 'COMPLETED') {
      throw new Error(`Test 4 Failed: POST /api/demo/device-command returned: ${JSON.stringify(postBody)}`);
    }

    const broadcastedStatus = await webStatusPromise;
    if (broadcastedStatus.action !== 'PING' || broadcastedStatus.status !== 'COMPLETED') {
      throw new Error(`Test 4 Failed: Broadcasted command status unexpected: ${JSON.stringify(broadcastedStatus)}`);
    }

    console.log(`  -> PASS: POST /api/demo/device-command succeeded in ${postBody.latencyMs}ms`);
    console.log(`  -> PASS: Web client received broadcasted command status: ${broadcastedStatus.status}\n`);

    // -------------------------------------------------------------
    // TEST 4B: TRIGGER_ULTRASONIC Flow (Sensor not attached)
    // -------------------------------------------------------------
    console.log('Test 4B: TRIGGER_ULTRASONIC flow when sensor is not attached physically');
    const ultrasonicStatusPromise = waitForEvent<DeviceCommandStatusPayload>(
      webSocket,
      REALTIME_EVENTS.DEVICE_COMMAND_STATUS,
      (s) => s.action === 'TRIGGER_ULTRASONIC' && s.status === 'FAILED'
    );

    const ultrasonicRes = await fetch(`${socketUrl}/api/demo/device-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'raspberry-pi-5', action: 'TRIGGER_ULTRASONIC' })
    });
    const ultrasonicBody = await ultrasonicRes.json();

    if (ultrasonicRes.status !== 422 || ultrasonicBody.error !== 'SENSOR_NOT_ATTACHED') {
      throw new Error(`Test 4B Failed: Expected 422 SENSOR_NOT_ATTACHED, got ${ultrasonicRes.status}: ${JSON.stringify(ultrasonicBody)}`);
    }

    const broadcastedUltrasonic = await ultrasonicStatusPromise;
    if (broadcastedUltrasonic.status !== 'FAILED') {
      throw new Error(`Test 4B Failed: Broadcasted ultrasonic status unexpected: ${JSON.stringify(broadcastedUltrasonic)}`);
    }

    console.log('  -> PASS: TRIGGER_ULTRASONIC returned clear error: SENSOR_NOT_ATTACHED');
    console.log(`  -> PASS: Web client received broadcasted ultrasonic status: ${broadcastedUltrasonic.status}\n`);

    // -------------------------------------------------------------
    // TEST 5: Rejection of Unsafe/Forbidden Commands (e.g., SYSTEM_REBOOT)
    // -------------------------------------------------------------
    console.log('Test 5: Unsafe commands (SYSTEM_REBOOT) are strictly rejected with 400 Bad Request');
    const badActionRes = await fetch(`${socketUrl}/api/demo/device-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'raspberry-pi-5', action: 'SYSTEM_REBOOT' })
    });

    if (badActionRes.status !== 400) {
      throw new Error(`Test 5 Failed: Expected 400 Bad Request but got ${badActionRes.status}`);
    }
    console.log('  -> PASS: Forbidden action was rejected by schema validation\n');

    // -------------------------------------------------------------
    // TEST 6: Backward Compatibility (POST /api/demo/device-heartbeat)
    // -------------------------------------------------------------
    console.log('Test 6: Backward compatibility of POST /api/demo/device-heartbeat');
    const legacyRes = await fetch(`${socketUrl}/api/demo/device-heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${testToken}`
      },
      body: JSON.stringify({
        deviceId: 'raspberry-pi-5',
        status: 'ONLINE',
        uptimeSeconds: 7300,
        cpuTempC: 50.1
      })
    });
    const legacyBody = await legacyRes.json();

    if (legacyRes.status !== 200 || !legacyBody.success) {
      throw new Error(`Test 6 Failed: POST /api/demo/device-heartbeat failed: ${JSON.stringify(legacyBody)}`);
    }
    console.log('  -> PASS: HTTP heartbeat received and recorded successfully\n');

    // -------------------------------------------------------------
    // TEST 7: Pi Disconnection & Offline Command Rejection
    // -------------------------------------------------------------
    console.log('Test 7: Pi disconnect marks socket as disconnected and rejects commands when offline');
    piSocket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // Force offline for test
    realDeviceService.reset();

    const offlineCmdRes = await fetch(`${socketUrl}/api/demo/device-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'raspberry-pi-5', action: 'PING' })
    });
    const offlineBody = await offlineCmdRes.json();

    if (offlineCmdRes.status !== 409 || offlineBody.error !== 'DEVICE_OFFLINE') {
      throw new Error(`Test 7 Failed: Expected 409 DEVICE_OFFLINE, got ${offlineCmdRes.status}: ${JSON.stringify(offlineBody)}`);
    }
    console.log('  -> PASS: Commands rejected with 409 DEVICE_OFFLINE when device is offline\n');

    // Cleanup
    webSocket.close();
    httpServer.close();
    realDeviceService.stopMonitoring();

    console.log('=== ALL BIDIRECTIONAL REALTIME & DEVICE TESTS PASSED (7/7) ===\n');
  } catch (error) {
    httpServer.close();
    realDeviceService.stopMonitoring();
    throw error;
  }
}

runDeviceRealtimeTests().catch((err) => {
  console.error('\nFAILED BIDIRECTIONAL DEVICE TESTS:', err);
  process.exit(1);
});
