import { createServer } from 'node:http';
import express from 'express';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { RealtimeGateway } from './realtime.gateway.js';
import { REALTIME_EVENTS } from './realtime.contract.js';
import { RealDeviceService, realDeviceService } from '../../demo/real-device.service.js';
import { demoService } from '../../demo/demo.service.js';
import dashboardRoutes from '../../routes/dashboard.routes.js';
import demoRouter from '../../routes/demo.routes.js';
import { prisma } from '../../lib/prisma.js';
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
  console.log('=== RUNNING BACKEND & ALERT CENTER LID ERROR ALERT TESTS ===\n');

  // Mock Prisma alert table in memory to verify persistence and GET /api/dashboard/alerts without requiring live DB
  const mockDbAlerts: any[] = [
    {
      id: 'existing-fill-alert-1',
      binId: 'bin-recyclable-a',
      type: 'CRITICAL',
      severity: 'CRITICAL',
      message: 'Thùng rác tái chế đã đầy (92%)',
      isResolved: false,
      createdAt: new Date(Date.now() - 60000),
      resolvedAt: null,
      bin: { binCode: 'RECYCLABLE', name: 'Thùng tái chế', stationId: 'station_a_canonical_id' }
    }
  ];

  let prismaCreateCalls = 0;
  const origFindFirst = prisma.alert.findFirst.bind(prisma.alert);
  const origCreate = prisma.alert.create.bind(prisma.alert);
  const origFindMany = prisma.alert.findMany.bind(prisma.alert);

  (prisma.alert as any).findFirst = async (args: any) => {
    const msg = args?.where?.message;
    const isResolved = args?.where?.isResolved;
    return mockDbAlerts.find((a) => a.message === msg && a.isResolved === isResolved) ?? null;
  };

  (prisma.alert as any).create = async (args: any) => {
    prismaCreateCalls++;
    const record = {
      id: args.data.id || `cuid-lid-${prismaCreateCalls}`,
      binId: args.data.binId ?? null,
      type: args.data.type,
      severity: args.data.severity,
      message: args.data.message,
      isResolved: Boolean(args.data.isResolved),
      createdAt: args.data.createdAt || new Date(),
      resolvedAt: null,
      bin: null
    };
    mockDbAlerts.unshift(record);
    return record;
  };

  (prisma.alert as any).findMany = async () => {
    return [...mockDbAlerts];
  };

  const app = express();
  app.use(express.json());
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/demo', demoRouter);

  const httpServer = createServer(app);
  const gateway = new RealtimeGateway(httpServer);
  app.set('io', gateway.io);
  realDeviceService.setRealtime(gateway);

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

    // 2. Connect client and verify broadcasts + DB persistence from handleLidAlert
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
    if (alertCreatedPayload.binId !== null || alertCreatedPayload.deviceId !== null) {
      throw new Error('alert:created payload must have binId=null and deviceId=null so UI renders "Hệ thống"');
    }
    console.log('PASS [4]: Gateway broadcasts alert:created with unified warning message and system-level null binId/deviceId');

    // Wait briefly for async persistLidAlertToDb
    await new Promise((r) => setTimeout(r, 50));

    // 3. Verify GET /api/dashboard/alerts (Trung tâm cảnh báo) returns the lid alert AND preserves existing fill-level alerts!
    const alertsRes = await fetch(`${serverUrl}/api/dashboard/alerts`);
    if (!alertsRes.ok) {
      throw new Error(`GET /api/dashboard/alerts failed with HTTP ${alertsRes.status}`);
    }
    const alertsData = (await alertsRes.json()) as { alerts: any[] };
    const lidAlertsInCenter = alertsData.alerts.filter(
      (a) => a.message === RealDeviceService.LID_ALERT_MESSAGE && !a.isResolved
    );
    if (lidAlertsInCenter.length !== 1) {
      throw new Error(`Expected exactly 1 lid alert in Trung tâm cảnh báo (/api/dashboard/alerts), got ${lidAlertsInCenter.length}`);
    }
    const lidAlertRow = lidAlertsInCenter[0];
    if (lidAlertRow.binId !== null || lidAlertRow.bin !== null || lidAlertRow.deviceId !== null) {
      throw new Error(`Lid alert row in Trung tâm cảnh báo must have binId=null, bin=null, deviceId=null`);
    }
    const fillAlertRow = alertsData.alerts.find((a) => a.id === 'existing-fill-alert-1');
    if (!fillAlertRow || fillAlertRow.bin?.binCode !== 'RECYCLABLE') {
      throw new Error('Existing fill-level alert must be preserved in Trung tâm cảnh báo');
    }
    console.log('PASS [5]: GET /api/dashboard/alerts (Trung tâm cảnh báo) includes the lid error alert and preserves fill-level alerts');

    // Verify DemoService also includes the lid alert when active
    const demoAlerts = demoService.getAllAlerts();
    const demoLidAlerts = demoAlerts.filter((a) => a.message === RealDeviceService.LID_ALERT_MESSAGE);
    if (demoLidAlerts.length !== 1) {
      throw new Error(`Expected DemoService.getAllAlerts() to contain 1 lid alert, got ${demoLidAlerts.length}`);
    }
    console.log('PASS [6]: DemoService.getAllAlerts() includes the lid error alert without duplicates');

    client.disconnect();

    // 4. Connect device client and verify telemetry packet with lidAlert=true triggers alert
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
    console.log('PASS [7]: Telemetry with lidAlert=true successfully triggers unified lid alert');

    // 5. Verify no duplicate alert:created or duplicate DB records when subsequent packets arrive or handleLidAlert is called again
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
    const alertsResAfterDup = await fetch(`${serverUrl}/api/dashboard/alerts`);
    const alertsDataAfterDup = (await alertsResAfterDup.json()) as { alerts: any[] };
    const lidAlertsCountAfterDup = alertsDataAfterDup.alerts.filter(
      (a) => a.message === RealDeviceService.LID_ALERT_MESSAGE && !a.isResolved
    ).length;
    if (lidAlertsCountAfterDup !== 1) {
      throw new Error(`Expected 1 lid alert in GET /api/dashboard/alerts after repeated triggers, got ${lidAlertsCountAfterDup}`);
    }
    console.log('PASS [8]: Calling handleLidAlert multiple times does NOT emit duplicate alerts or create duplicate records in Trung tâm cảnh báo');

    // 6. Verify subsequent normal telemetry packets (without error) do NOT clear lidAlert
    deviceClient.emit(REALTIME_EVENTS.DEVICE_TELEMETRY, {
      deviceId: 'raspberry-pi-5',
      stationCode: 'STATION_A',
      status: 'ONLINE',
      uptimeSeconds: 124,
      lidAlert: false,
      sensors: {
        recyclable: { fillLevel: 55, status: 'OK' }
      }
    });

    await new Promise((r) => setTimeout(r, 200));
    if (realDeviceService.getStatus().lidAlert !== true) {
      throw new Error('Lid alert must NOT be cleared by subsequent normal telemetry packets');
    }
    const alertsResAfterNormal = await fetch(`${serverUrl}/api/dashboard/alerts`);
    const alertsDataAfterNormal = (await alertsResAfterNormal.json()) as { alerts: any[] };
    const lidAlertsCountAfterNormal = alertsDataAfterNormal.alerts.filter(
      (a) => a.message === RealDeviceService.LID_ALERT_MESSAGE && !a.isResolved
    ).length;
    if (lidAlertsCountAfterNormal !== 1) {
      throw new Error('Subsequent normal sensor telemetry must NOT remove lid alert from Trung tâm cảnh báo');
    }
    console.log('PASS [9]: Subsequent normal telemetry packets do NOT clear the lid alert in RAM or Trung tâm cảnh báo');

    deviceClient.disconnect();
    webClient.disconnect();

    console.log('\n=== ALL BACKEND & ALERT CENTER LID ALERT TESTS PASSED ===');
  } finally {
    (prisma.alert as any).findFirst = origFindFirst;
    (prisma.alert as any).create = origCreate;
    (prisma.alert as any).findMany = origFindMany;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

runLidAlertTests().catch((err) => {
  console.error('Lid alert tests failed:', err);
  process.exit(1);
});
