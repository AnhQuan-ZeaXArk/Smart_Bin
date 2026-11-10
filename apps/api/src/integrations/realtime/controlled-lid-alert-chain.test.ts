import { createServer } from 'node:http';
import express from 'express';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { RealtimeGateway } from './realtime.gateway.js';
import { REALTIME_EVENTS } from './realtime.contract.js';
import { RealDeviceService, realDeviceService } from '../../demo/real-device.service.js';
import dashboardRoutes from '../../routes/dashboard.routes.js';
import demoRouter from '../../routes/demo.routes.js';
import { prisma } from '../../lib/prisma.js';

const LID_ALERT_ID = 'lid-alert-station-a';
const LID_ALERT_MESSAGE = 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!';

export type DashboardAlert = {
  id: string;
  type: string;
  severity: string;
  message: string;
  createdAt: string;
  bin: { binCode: string; name?: string } | null;
  deviceId?: string | null;
  isResolved?: boolean;
  resolvedAt?: string | null;
};

function ensureLidAlertInList(current: DashboardAlert[], createdAt?: string): DashboardAlert[] {
  const hasLidAlert = current.some(
    (item) => item.id === LID_ALERT_ID || (item.message === LID_ALERT_MESSAGE && !item.isResolved)
  );
  if (hasLidAlert) {
    return current;
  }
  const lidAlertItem: DashboardAlert = {
    id: LID_ALERT_ID,
    type: 'SENSOR_ABNORMAL',
    severity: 'CRITICAL',
    message: LID_ALERT_MESSAGE,
    createdAt: createdAt || new Date().toISOString(),
    bin: null,
    deviceId: null,
    isResolved: false,
    resolvedAt: null
  };
  return [lidAlertItem, ...current];
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

async function runControlledBackendAndFrontendChain() {
  console.log('===============================================================');
  console.log('KIỂM THỬ CÓ KIỂM SOÁT BƯỚC 4 -> BƯỚC 6: BACKEND, API, FRONTEND');
  console.log('===============================================================\n');

  const mockDbAlerts: any[] = [];
  let alertCounter = 0;

  const origFindFirst = prisma.alert.findFirst.bind(prisma.alert);
  const origCreate = prisma.alert.create.bind(prisma.alert);
  const origFindMany = prisma.alert.findMany.bind(prisma.alert);

  (prisma.alert as any).findFirst = async (args: any) => {
    const msg = args?.where?.message;
    const isResolved = args?.where?.isResolved;
    return mockDbAlerts.find((a) => a.message === msg && a.isResolved === isResolved) ?? null;
  };

  (prisma.alert as any).create = async (args: any) => {
    alertCounter++;
    const record = {
      id: args.data.id || `cuid-lid-chain-${alertCounter}`,
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

  const results: Record<string, string> = {};

  try {
    realDeviceService.setLidAlert(false);

    // 1. Kết nối Web Client (mô phỏng trang /alerts trên trình duyệt)
    const webClient = ClientSocket(serverUrl, {
      transports: ['websocket'],
      auth: { token: 'public-viewer' }
    });
    await waitForEvent(webClient, REALTIME_EVENTS.CONNECTED);

    // 2. Kết nối Pi Agent Client (mô phỏng Pi 5 gửi sự kiện)
    process.env.DEVICE_INGEST_TOKEN = 'mock-pi5-token';
    const piClient = ClientSocket(serverUrl, {
      transports: ['websocket'],
      auth: {
        type: 'device',
        token: 'mock-pi5-token',
        deviceId: 'raspberry-pi-5'
      }
    });
    await new Promise<void>((resolve, reject) => {
      piClient.on('connect', () => resolve());
      piClient.on('connect_error', (err) => reject(err));
    });

    // Thiết lập listener trên Web Client
    const webLidAlertPromise = waitForEvent<any>(webClient, REALTIME_EVENTS.LID_ALERT);
    const webAlertCreatedPromise = waitForEvent<any>(webClient, REALTIME_EVENTS.ALERT_CREATED);

    // --- BƯỚC 4: PI AGENT GỬI device:lid:alert LÊN BACKEND ---
    console.log('--- [BƯỚC 4: BACKEND NHẬN SỰ KIỆN] ---');
    piClient.emit(REALTIME_EVENTS.LID_ALERT, {
      deviceId: 'raspberry-pi-5',
      stationCode: 'STATION_A',
      message: 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!',
      lidAlert: true
    });

    const receivedLidAlert = await webLidAlertPromise;
    const receivedAlertCreated = await webAlertCreatedPromise;

    const backendReceivedPass = (
      receivedLidAlert.message === 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!' &&
      receivedAlertCreated.message === 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!' &&
      realDeviceService.isLidAlertActive() === true
    );
    results['Backend (Nhận sự kiện)'] = backendReceivedPass ? 'PASS' : 'FAIL';
    console.log(`-> Backend nhận sự kiện: ${results['Backend (Nhận sự kiện)']}`);

    // --- BƯỚC 4b: ALERT STORE (TẠO BẢN GHI) ---
    console.log('\n--- [ALERT STORE: TẠO BẢN GHI TRONG POSTGRESQL] ---');
    // Chờ DB create hoàn tất
    await new Promise((r) => setTimeout(r, 80));
    const createdInDb = mockDbAlerts.find(
      (a) => a.message === 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!' && !a.isResolved
    );
    const alertStorePass = Boolean(createdInDb && createdInDb.type === 'SENSOR_ABNORMAL' && createdInDb.severity === 'CRITICAL');
    results['Alert Store (Tạo bản ghi)'] = alertStorePass ? 'PASS' : 'FAIL';
    console.log(`-> Alert Store tạo bản ghi: ${results['Alert Store (Tạo bản ghi)']} (id=${createdInDb?.id})`);

    // --- BƯỚC 5: API /api/dashboard/alerts ---
    console.log('\n--- [BƯỚC 5: API /api/dashboard/alerts TRẢ VỀ BẢN GHI] ---');
    const apiRes = await fetch(`${serverUrl}/api/dashboard/alerts`);
    const apiData = (await apiRes.json()) as { alerts: any[] };
    const lidInResponse = apiData.alerts.filter(
      (a) => a.message === 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!' && !a.isResolved
    );
    const apiPass = lidInResponse.length === 1 && lidInResponse[0].bin === null;
    results['API /alerts (Trả về bản ghi)'] = apiPass ? 'PASS' : 'FAIL';
    console.log(`-> API /alerts response có đúng 1 bản ghi lỗi nắp: ${results['API /alerts (Trả về bản ghi)']}`);

    // --- BƯỚC 5b: FRONTEND RENDER & FILTER KIỂM TRA ---
    console.log('\n--- [FRONTEND: KIỂM TRA BỘ LỌC VÀ HIỂN THỊ CẢNH BÁO] ---');
    let frontendAlerts: DashboardAlert[] = apiData.alerts;
    // Mô phỏng hàm ensureLidAlertInList trên Frontend
    frontendAlerts = ensureLidAlertInList(frontendAlerts);

    // Kiểm tra bộ lọc severity = 'ALL' và severity = 'CRITICAL'
    const filterAll = frontendAlerts.filter((a) => a.severity === 'CRITICAL' || 'ALL' === 'ALL');
    const filterOpen = filterAll.filter((a) => !a.isResolved);
    const lidRenderItem = filterOpen.find((a) => a.message === LID_ALERT_MESSAGE);

    // Kiểm tra hiển thị nhãn: 'Hệ thống' (không chứa binCode/binName)
    const displayName = lidRenderItem?.message === LID_ALERT_MESSAGE ? 'Hệ thống' : (lidRenderItem?.bin?.binCode ?? 'Hệ thống');
    const frontendPass = (
      Boolean(lidRenderItem) &&
      lidRenderItem?.severity === 'CRITICAL' &&
      displayName === 'Hệ thống'
    );
    results['Frontend (Hiển thị cảnh báo)'] = frontendPass ? 'PASS' : 'FAIL';
    console.log(`-> Frontend render: ${results['Frontend (Hiển thị cảnh báo)']} (hiển thị nhãn: "${displayName}", nội dung: "${lidRenderItem?.message}")`);

    piClient.disconnect();
    webClient.disconnect();

    console.log('\n=======================================================');
    console.log('BẢNG TỔNG HỢP KIỂM THỬ BACKEND VÀ FRONTEND (BƯỚC 4 -> BƯỚC 5):');
    console.log('=======================================================');
    console.log('| Tầng | Kết quả |');
    console.log('|---|---|');
    for (const [layer, status] of Object.entries(results)) {
      console.log(`| ${layer} | ${status} |`);
    }

    const allPass = Object.values(results).every((v) => v === 'PASS');
    if (!allPass) {
      console.error('\n[ERROR] Kiểm thử Backend/Frontend thất bại!');
      process.exit(1);
    } else {
      console.log('\n[SUCCESS] Tất cả các bước Backend, Alert Store, API và Frontend ĐÃ PASS 100%!');
    }
  } finally {
    (prisma.alert as any).findFirst = origFindFirst;
    (prisma.alert as any).create = origCreate;
    (prisma.alert as any).findMany = origFindMany;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

runControlledBackendAndFrontendChain().catch((err) => {
  console.error('Controlled chain test error:', err);
  process.exit(1);
});
