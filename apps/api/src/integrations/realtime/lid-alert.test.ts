import { createServer } from 'node:http';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { RealtimeGateway } from './realtime.gateway.js';
import { REALTIME_EVENTS } from './realtime.contract.js';
import { realDeviceService } from '../../demo/real-device.service.js';
import { env } from '../../config/env.js';

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

async function runLidAlertTests() {
  console.log('=== RUNNING BACKEND LID ERROR ALERT TESTS ===\n');

  const httpServer = createServer();
  const gateway = new RealtimeGateway(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as any).port;
  const serverUrl = `http://localhost:${port}`;

  try {
    // 1. Test RealDeviceService lidAlert state
    realDeviceService.setLidAlert(false);
    let status = realDeviceService.getStatus();
    if (status.lidAlert !== false) {
      throw new Error(`Expected lidAlert to be false initially, got: ${status.lidAlert}`);
    }
    console.log('PASS [1]: RealDeviceService initial lidAlert is false');

    realDeviceService.setLidAlert(true);
    status = realDeviceService.getStatus();
    if (status.lidAlert !== true) {
      throw new Error(`Expected lidAlert to be true after setLidAlert(true), got: ${status.lidAlert}`);
    }
    console.log('PASS [2]: RealDeviceService setLidAlert(true) sets lidAlert flag');

    // Reset back to false before testing gateway.handleLidAlert trigger
    realDeviceService.setLidAlert(false);

    // 2. Connect client and verify broadcasts from handleLidAlert
    const client = ClientSocket(serverUrl, {
      transports: ['websocket'],
      auth: { token: 'public-viewer' }
    });
    await waitForEvent(client, REALTIME_EVENTS.CONNECTED);

    const lidAlertPromise = waitForEvent<any>(client, REALTIME_EVENTS.LID_ALERT);
    const alertCreatedPromise = waitForEvent<any>(client, REALTIME_EVENTS.ALERT_CREATED);

    gateway.handleLidAlert();

    const lidAlertPayload = await lidAlertPromise;
    const alertCreatedPayload = await alertCreatedPromise;

    if (lidAlertPayload.message !== 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!') {
      throw new Error(`Unexpected message in device:lid:alert: ${lidAlertPayload.message}`);
    }
    if (lidAlertPayload.binCode || lidAlertPayload.binName || lidAlertPayload.binId) {
      throw new Error('Lid alert must NOT display or specify bin code or bin name');
    }
    console.log('PASS [3]: Gateway broadcasts device:lid:alert with exact message and without bin identifiers');

    if (alertCreatedPayload.message !== 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!') {
      throw new Error(`Unexpected message in alert:created: ${alertCreatedPayload.message}`);
    }
    console.log('PASS [4]: Gateway broadcasts alert:created with unified warning message');

    client.disconnect();

    // 3. Connect device client and verify telemetry packet with lidAlert=true triggers alert
    process.env.DEVICE_INGEST_TOKEN = 'test-device-token';
    realDeviceService.setLidAlert(false);
    const deviceClient = ClientSocket(serverUrl, {
      transports: ['websocket'],
      auth: {
        type: 'device',
        token: 'test-device-token',
        deviceId: 'raspberry-pi-5'
      }
    });
    await new Promise<void>((resolve, reject) => {
      deviceClient.on('connect', () => resolve());
      deviceClient.on('connect_error', (err) => reject(err));
    });

    const webClient = ClientSocket(serverUrl, {
      transports: ['websocket'],
      auth: { token: 'public-viewer' }
    });
    await waitForEvent(webClient, REALTIME_EVENTS.CONNECTED);

    const webLidAlertPromise = waitForEvent<any>(webClient, REALTIME_EVENTS.LID_ALERT);

    deviceClient.emit(REALTIME_EVENTS.DEVICE_TELEMETRY, {
      deviceId: 'raspberry-pi-5',
      stationCode: 'STATION_A',
      status: 'ONLINE',
      uptimeSeconds: 120,
      lidAlert: true
    });

    const telemetryAlert = await webLidAlertPromise;
    if (telemetryAlert.message !== 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!') {
      throw new Error(`Unexpected message from telemetry-triggered lid alert: ${telemetryAlert.message}`);
    }
    if (realDeviceService.getStatus().lidAlert !== true) {
      throw new Error('RealDeviceService status should have lidAlert=true after telemetry ingestion');
    }
    console.log('PASS [5]: Telemetry with lidAlert=true successfully triggers unified lid alert');

    // 4. Verify no duplicate alert:created is broadcasted when subsequent packets arrive or handleLidAlert is called again
    let duplicateAlertCreatedCount = 0;
    webClient.on(REALTIME_EVENTS.ALERT_CREATED, () => {
      duplicateAlertCreatedCount++;
    });

    gateway.handleLidAlert();
    gateway.handleLidAlert();

    deviceClient.emit(REALTIME_EVENTS.DEVICE_TELEMETRY, {
      deviceId: 'raspberry-pi-5',
      stationCode: 'STATION_A',
      status: 'ONLINE',
      uptimeSeconds: 122,
      lidAlert: true
    });

    await new Promise((r) => setTimeout(r, 200));
    if (duplicateAlertCreatedCount > 0) {
      throw new Error(`Expected 0 duplicate alert:created events, received: ${duplicateAlertCreatedCount}`);
    }
    console.log('PASS [6]: Calling handleLidAlert multiple times does NOT emit duplicate alerts');

    // 5. Verify subsequent normal telemetry packets (without error) do NOT clear lidAlert
    deviceClient.emit(REALTIME_EVENTS.DEVICE_TELEMETRY, {
      deviceId: 'raspberry-pi-5',
      stationCode: 'STATION_A',
      status: 'ONLINE',
      uptimeSeconds: 124,
      lidAlert: false
    });

    await new Promise((r) => setTimeout(r, 200));
    if (realDeviceService.getStatus().lidAlert !== true) {
      throw new Error('Lid alert must NOT be cleared by subsequent normal telemetry packets');
    }
    console.log('PASS [7]: Subsequent normal telemetry packets do NOT clear the lid alert');

    deviceClient.disconnect();
    webClient.disconnect();

    console.log('\n=== ALL BACKEND LID ALERT TESTS PASSED ===');
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

runLidAlertTests().catch((err) => {
  console.error('Lid alert tests failed:', err);
  process.exit(1);
});
