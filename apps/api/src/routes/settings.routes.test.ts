import { createServer } from 'node:http';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { AlertType, AlertSeverity } from '@prisma/client';
import { app } from '../app.js';
import { RealtimeGateway } from '../integrations/realtime/realtime.gateway.js';
import { REALTIME_EVENTS } from '../integrations/realtime/realtime.contract.js';
import { settingsService } from '../services/settings.service.js';
import { prisma } from '../lib/prisma.js';
import { getFillCategory } from './bin.routes.js';
import { updateFillAlert } from '../services/alert.service.js';

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
        return;
      }
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(data);
    }

    socket.on(event, listener);
  });
}

async function runSettingsTests() {
  console.log('=== RUNNING SMARTBIN SETTINGS THRESHOLD INTEGRATION TESTS ===\n');

  const httpServer = createServer(app);
  const realtime = new RealtimeGateway(httpServer);
  app.set('realtime', realtime);
  app.set('io', realtime.io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  let clientA: ClientSocketType | null = null;
  let clientB: ClientSocketType | null = null;

  try {
    // ----------------------------------------------------
    // Test 1: GET /api/settings/thresholds (Public access)
    // ----------------------------------------------------
    console.log('Test 1: GET /api/settings/thresholds returns threshold configuration without authentication');
    const res1 = await fetch(`${baseUrl}/api/settings/thresholds`);
    if (!res1.ok) {
      throw new Error(`Test 1 Failed: Expected status 200, got ${res1.status}`);
    }
    const data1 = await res1.json();
    if (!data1.success || !data1.thresholds) {
      throw new Error(`Test 1 Failed: Expected thresholds in payload: ${JSON.stringify(data1)}`);
    }
    console.log(`  -> PASS: Initial thresholds received: ${JSON.stringify(data1.thresholds)}\n`);

    // ----------------------------------------------------
    // Test 2: Connect 2 Web clients via Socket.IO
    // ----------------------------------------------------
    console.log('Test 2: Connect 2 independent Web clients (User A & User B) via Socket.IO');
    clientA = ClientSocket(baseUrl, { transports: ['websocket'] });
    clientB = ClientSocket(baseUrl, { transports: ['websocket'] });

    await Promise.all([
      new Promise<void>((resolve) => clientA!.on('connect', () => resolve())),
      new Promise<void>((resolve) => clientB!.on('connect', () => resolve()))
    ]);
    console.log('  -> PASS: Both Socket.IO clients connected successfully\n');

    // ----------------------------------------------------
    // Test 3: PUT /api/settings/thresholds & Realtime broadcast
    // ----------------------------------------------------
    console.log('Test 3: User A saves new valid thresholds (40, 60, 80) -> User B receives realtime update via Socket.IO');
    const waitPromiseB = waitForEvent(clientB, REALTIME_EVENTS.SETTINGS_THRESHOLDS_UPDATED);

    const updateRes = await fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warningThreshold: 40,
        nearFullThreshold: 60,
        fullThreshold: 80
      })
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      throw new Error(`Test 3 Failed: PUT failed with ${updateRes.status}: ${err}`);
    }
    const updateData = await updateRes.json();
    if (
      updateData.thresholds.warningThreshold !== 40 ||
      updateData.thresholds.nearFullThreshold !== 60 ||
      updateData.thresholds.fullThreshold !== 80
    ) {
      throw new Error(`Test 3 Failed: Unexpected response thresholds: ${JSON.stringify(updateData)}`);
    }

    const eventB: any = await waitPromiseB;
    if (
      eventB.warningThreshold !== 40 ||
      eventB.nearFullThreshold !== 60 ||
      eventB.fullThreshold !== 80
    ) {
      throw new Error(`Test 3 Failed: Client B received incorrect event data: ${JSON.stringify(eventB)}`);
    }
    console.log(`  -> PASS: Client B received Socket.IO event: warning=${eventB.warningThreshold}%, nearFull=${eventB.nearFullThreshold}%, full=${eventB.fullThreshold}%\n`);

    // ----------------------------------------------------
    // Test 4: Re-fetching returns updated thresholds (PostgreSQL persistence)
    // ----------------------------------------------------
    console.log('Test 4: Subsequent HTTP GET returns updated thresholds');
    const res4 = await fetch(`${baseUrl}/api/settings/thresholds`);
    const data4 = await res4.json();
    if (
      data4.thresholds.warningThreshold !== 40 ||
      data4.thresholds.nearFullThreshold !== 60 ||
      data4.thresholds.fullThreshold !== 80
    ) {
      throw new Error(`Test 4 Failed: Expected (40, 60, 80), got ${JSON.stringify(data4)}`);
    }
    console.log('  -> PASS: Verified persistence via HTTP GET\n');

    // ----------------------------------------------------
    // Test 5: Rejection of out-of-bounds values (< 0 or > 100)
    // ----------------------------------------------------
    console.log('Test 5: Reject values out of [0, 100] range');
    const negRes = await fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warningThreshold: -5, nearFullThreshold: 50, fullThreshold: 90 })
    });
    if (negRes.status !== 400) {
      throw new Error(`Test 5 Failed: Expected 400 for negative value, got ${negRes.status}`);
    }

    const overRes = await fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warningThreshold: 30, nearFullThreshold: 70, fullThreshold: 105 })
    });
    if (overRes.status !== 400) {
      throw new Error(`Test 5 Failed: Expected 400 for value > 100, got ${overRes.status}`);
    }
    console.log('  -> PASS: Correctly rejected values outside 0–100\n');

    // ----------------------------------------------------
    // Test 6: Rejection of invalid order (warning >= nearFull or nearFull >= full)
    // ----------------------------------------------------
    console.log('Test 6: Reject invalid threshold ordering');
    const orderRes1 = await fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warningThreshold: 70, nearFullThreshold: 50, fullThreshold: 90 })
    });
    if (orderRes1.status !== 400) {
      throw new Error(`Test 6 Failed: Expected 400 for warning >= nearFull, got ${orderRes1.status}`);
    }

    const orderRes2 = await fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warningThreshold: 30, nearFullThreshold: 90, fullThreshold: 90 })
    });
    if (orderRes2.status !== 400) {
      throw new Error(`Test 6 Failed: Expected 400 for nearFull == full, got ${orderRes2.status}`);
    }
    console.log('  -> PASS: Correctly rejected invalid threshold ordering\n');

    // ----------------------------------------------------
    // Test 7: Support snake_case field names
    // ----------------------------------------------------
    console.log('Test 7: Support snake_case input (warning_threshold, near_full_threshold, full_threshold)');
    const snakeRes = await fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warning_threshold: 45,
        near_full_threshold: 65,
        full_threshold: 85
      })
    });
    if (!snakeRes.ok) {
      throw new Error(`Test 7 Failed: Expected 200 with snake_case, got ${snakeRes.status}`);
    }
    const snakeData = await snakeRes.json();
    if (
      snakeData.thresholds.warningThreshold !== 45 ||
      snakeData.thresholds.nearFullThreshold !== 65 ||
      snakeData.thresholds.fullThreshold !== 85
    ) {
      throw new Error(`Test 7 Failed: Mismatched data from snake_case: ${JSON.stringify(snakeData)}`);
    }
    console.log('  -> PASS: snake_case payload parsed and saved cleanly\n');

    // ----------------------------------------------------
    // Test 8: Concurrent updates handling
    // ----------------------------------------------------
    console.log('Test 8: Concurrent updates by two users simultaneously -> Atomic last-write-wins');
    const pA = fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warningThreshold: 30, nearFullThreshold: 50, fullThreshold: 70 })
    });
    const pB = fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warningThreshold: 50, nearFullThreshold: 70, fullThreshold: 90 })
    });

    const [rA, rB] = await Promise.all([pA, pB]);
    if (!rA.ok || !rB.ok) {
      throw new Error(`Test 8 Failed: Expected both requests to succeed, got rA=${rA.status}, rB=${rB.status}`);
    }

    const latestRes = await fetch(`${baseUrl}/api/settings/thresholds`);
    const latestData = await latestRes.json();
    const finalT = latestData.thresholds;
    const isSetA = finalT.warningThreshold === 30 && finalT.nearFullThreshold === 50 && finalT.fullThreshold === 70;
    const isSetB = finalT.warningThreshold === 50 && finalT.nearFullThreshold === 70 && finalT.fullThreshold === 90;
    if (!isSetA && !isSetB) {
      throw new Error(`Test 8 Failed: Threshold fields were mixed: ${JSON.stringify(finalT)}`);
    }
    console.log(`  -> PASS: Atomic resolution confirmed: final state is consistent set: (${finalT.warningThreshold}, ${finalT.nearFullThreshold}, ${finalT.fullThreshold})\n`);

    // ----------------------------------------------------
    // Test 9: Dynamic alerting / Fill category integration
    // ----------------------------------------------------
    console.log('Test 9: Fill category computation applies dynamic thresholds');
    const catNormal = getFillCategory(40, { warningThreshold: 50, nearFullThreshold: 70, fullThreshold: 90 });
    const catMonitor = getFillCategory(60, { warningThreshold: 50, nearFullThreshold: 70, fullThreshold: 90 });
    const catNearlyFull = getFillCategory(80, { warningThreshold: 50, nearFullThreshold: 70, fullThreshold: 90 });
    const catCritical = getFillCategory(95, { warningThreshold: 50, nearFullThreshold: 70, fullThreshold: 90 });

    if (catNormal !== 'NORMAL' || catMonitor !== 'MONITOR' || catNearlyFull !== 'NEARLY_FULL' || catCritical !== 'CRITICAL') {
      throw new Error(`Test 9 Failed: Categories mismatch: ${catNormal}, ${catMonitor}, ${catNearlyFull}, ${catCritical}`);
    }
    console.log('  -> PASS: Dynamic categories correctly computed according to active thresholds\n');

    // ----------------------------------------------------
    // Test 10: Origin and Referer validation (CSRF defense)
    // ----------------------------------------------------
    console.log('Test 10: Origin and Referer validation (CSRF defense for public PUT endpoint)');
    const evilOriginRes = await fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil-phishing-attacker.com'
      },
      body: JSON.stringify({ warningThreshold: 40, nearFullThreshold: 60, fullThreshold: 80 })
    });
    if (evilOriginRes.status !== 403) {
      throw new Error(`Test 10 Failed: Expected 403 Forbidden for evil Origin, got ${evilOriginRes.status}`);
    }

    const evilRefererRes = await fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://malicious-site.org/csrf-exploit'
      },
      body: JSON.stringify({ warningThreshold: 40, nearFullThreshold: 60, fullThreshold: 80 })
    });
    if (evilRefererRes.status !== 403) {
      throw new Error(`Test 10 Failed: Expected 403 Forbidden for evil Referer, got ${evilRefererRes.status}`);
    }

    const validOriginRes = await fetch(`${baseUrl}/api/settings/thresholds`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173'
      },
      body: JSON.stringify({ warningThreshold: 42, nearFullThreshold: 62, fullThreshold: 82 })
    });
    if (validOriginRes.status !== 200) {
      throw new Error(`Test 10 Failed: Expected 200 for allowed Origin, got ${validOriginRes.status}`);
    }
    console.log('  -> PASS: Origin/Referer checked and unauthorized cross-site requests blocked with 403 Forbidden\n');

    // ----------------------------------------------------
    // Test 11: Rate limiting protection (429 Too Many Requests)
    // ----------------------------------------------------
    console.log('Test 11: Rate limiter triggers 429 after exceeding limit');
    let got429 = false;
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${baseUrl}/api/settings/thresholds`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warningThreshold: 40, nearFullThreshold: 60, fullThreshold: 80 })
      });
      if (res.status === 429) {
        got429 = true;
        const body = await res.json();
        if (!body.message || !body.message.includes('quá thường xuyên')) {
          throw new Error(`Test 11 Failed: Unexpected 429 message: ${JSON.stringify(body)}`);
        }
        break;
      }
    }
    if (!got429) {
      throw new Error('Test 11 Failed: Expected 429 Too Many Requests after rapid requests');
    }
    console.log('  -> PASS: Rate limiter successfully protected endpoint with 429 Too Many Requests\n');

    // ----------------------------------------------------
    // Test 12: Complete 6-step fill level sequence with alert lifecycle & foreign alert preservation
    // ----------------------------------------------------
    console.log('Test 12: Complete 6-step fill level change sequence with alert lifecycle & foreign alert preservation');
    const testBinId = 'test-bin-seq';
    const testBinCode = 'SEQ-01';

    // Đảm bảo cấu hình ngưỡng chuẩn: Cảnh báo = 50%, Gần đầy = 70%, Đầy = 90%
    await settingsService.updateThresholds({
      warningThreshold: 50,
      nearFullThreshold: 70,
      fullThreshold: 90
    });

    // Dọn dẹp dữ liệu cũ nếu có
    await prisma.alert.deleteMany({ where: { binId: testBinId } });
    await prisma.bin.deleteMany({ where: { id: testBinId } });

    // Tạo ngăn rác kiểm thử
    await prisma.bin.create({
      data: {
        id: testBinId,
        binCode: testBinCode,
        name: 'Thùng rác kiểm thử tuần tự',
        location: 'Khu vực thử nghiệm',
        capacity: 240,
        currentFillLevel: 0
      }
    });

    // Tạo 2 cảnh báo phần cứng / thiết bị độc lập để kiểm tra tính bảo toàn
    const sensorAlert = await prisma.alert.create({
      data: {
        binId: testBinId,
        type: AlertType.SENSOR_ABNORMAL,
        severity: AlertSeverity.WARNING,
        message: 'Cảm biến siêu âm mất tín hiệu'
      }
    });
    const offlineAlert = await prisma.alert.create({
      data: {
        binId: testBinId,
        type: AlertType.DEVICE_OFFLINE,
        severity: AlertSeverity.CRITICAL,
        message: 'Raspberry Pi 5 mất kết nối'
      }
    });

    async function verifyHardwareAlertsUntouched() {
      const hwAlerts = await prisma.alert.findMany({
        where: {
          binId: testBinId,
          id: { in: [sensorAlert.id, offlineAlert.id] },
          isResolved: false
        }
      });
      if (hwAlerts.length !== 2) {
        throw new Error('Hardware alerts were unexpectedly altered or resolved!');
      }
    }

    // Step 1: 45% -> Không có cảnh báo (45% < 50%)
    const alertStep1 = await updateFillAlert(testBinId, testBinCode, 45);
    if (alertStep1 !== null) {
      throw new Error(`Step 1 Failed: Expected null for 45%, got ${JSON.stringify(alertStep1)}`);
    }
    const activeFill1 = await prisma.alert.findMany({
      where: { binId: testBinId, isResolved: false, type: { in: [AlertType.NEARLY_FULL, AlertType.CRITICAL] } }
    });
    if (activeFill1.length !== 0) {
      throw new Error(`Step 1 Failed: Expected 0 active fill alerts, found ${activeFill1.length}`);
    }
    await verifyHardwareAlertsUntouched();
    console.log('  -> Step 1 PASS: 45% -> No alert (null), 0 active fill alerts');

    // Step 2: 55% -> Cảnh báo INFO (NEARLY_FULL, INFO)
    const alertStep2 = await updateFillAlert(testBinId, testBinCode, 55);
    if (!alertStep2 || alertStep2.type !== AlertType.NEARLY_FULL || alertStep2.severity !== AlertSeverity.INFO) {
      throw new Error(`Step 2 Failed: Expected NEARLY_FULL / INFO, got ${JSON.stringify(alertStep2)}`);
    }
    const activeFill2 = await prisma.alert.findMany({
      where: { binId: testBinId, isResolved: false, type: { in: [AlertType.NEARLY_FULL, AlertType.CRITICAL] } }
    });
    if (activeFill2.length !== 1 || activeFill2[0].id !== alertStep2.id) {
      throw new Error('Step 2 Failed: Expected exactly 1 active fill alert matching step 2');
    }
    await verifyHardwareAlertsUntouched();
    console.log('  -> Step 2 PASS: 55% -> INFO alert (NEARLY_FULL, INFO)');

    // Step 3: 75% -> Cảnh báo WARNING (NEARLY_FULL, WARNING) - Cập nhật in-place, không tạo bản ghi trùng lặp
    const alertStep3 = await updateFillAlert(testBinId, testBinCode, 75);
    if (!alertStep3 || alertStep3.type !== AlertType.NEARLY_FULL || alertStep3.severity !== AlertSeverity.WARNING) {
      throw new Error(`Step 3 Failed: Expected NEARLY_FULL / WARNING, got ${JSON.stringify(alertStep3)}`);
    }
    if (alertStep3.id !== alertStep2.id) {
      throw new Error(`Step 3 Failed: Alert should be updated in-place without duplicate! Got id ${alertStep3.id} vs ${alertStep2.id}`);
    }
    const totalNearlyFullRecords = await prisma.alert.count({
      where: { binId: testBinId, type: AlertType.NEARLY_FULL }
    });
    if (totalNearlyFullRecords !== 1) {
      throw new Error(`Step 3 Failed: Duplicate NEARLY_FULL record created! Count: ${totalNearlyFullRecords}`);
    }
    const activeFill3 = await prisma.alert.findMany({
      where: { binId: testBinId, isResolved: false, type: { in: [AlertType.NEARLY_FULL, AlertType.CRITICAL] } }
    });
    if (activeFill3.length !== 1 || activeFill3[0].severity !== AlertSeverity.WARNING) {
      throw new Error('Step 3 Failed: Expected exactly 1 active fill alert with WARNING severity');
    }
    await verifyHardwareAlertsUntouched();
    console.log('  -> Step 3 PASS: 75% -> WARNING alert (NEARLY_FULL, WARNING, in-place update, no duplicate)');

    // Step 4: 95% -> Cảnh báo CRITICAL (CRITICAL, CRITICAL), giải quyết NEARLY_FULL cũ
    const alertStep4 = await updateFillAlert(testBinId, testBinCode, 95);
    if (!alertStep4 || alertStep4.type !== AlertType.CRITICAL || alertStep4.severity !== AlertSeverity.CRITICAL) {
      throw new Error(`Step 4 Failed: Expected CRITICAL / CRITICAL, got ${JSON.stringify(alertStep4)}`);
    }
    const oldNearlyFull = await prisma.alert.findUnique({ where: { id: alertStep2.id } });
    if (!oldNearlyFull || !oldNearlyFull.isResolved || !oldNearlyFull.resolvedAt) {
      throw new Error('Step 4 Failed: Previous NEARLY_FULL alert was not marked as resolved!');
    }
    const activeFill4 = await prisma.alert.findMany({
      where: { binId: testBinId, isResolved: false, type: { in: [AlertType.NEARLY_FULL, AlertType.CRITICAL] } }
    });
    if (activeFill4.length !== 1 || activeFill4[0].type !== AlertType.CRITICAL) {
      throw new Error('Step 4 Failed: Expected exactly 1 active fill alert of type CRITICAL');
    }
    await verifyHardwareAlertsUntouched();
    console.log('  -> Step 4 PASS: 95% -> CRITICAL alert (CRITICAL, CRITICAL), resolves previous NEARLY_FULL');

    // Step 5: 75% -> Giải quyết CRITICAL cũ, thiết lập WARNING (NEARLY_FULL)
    const alertStep5 = await updateFillAlert(testBinId, testBinCode, 75);
    if (!alertStep5 || alertStep5.type !== AlertType.NEARLY_FULL || alertStep5.severity !== AlertSeverity.WARNING) {
      throw new Error(`Step 5 Failed: Expected NEARLY_FULL / WARNING, got ${JSON.stringify(alertStep5)}`);
    }
    const oldCritical = await prisma.alert.findUnique({ where: { id: alertStep4.id } });
    if (!oldCritical || !oldCritical.isResolved || !oldCritical.resolvedAt) {
      throw new Error('Step 5 Failed: Previous CRITICAL alert was not marked as resolved!');
    }
    const activeFill5 = await prisma.alert.findMany({
      where: { binId: testBinId, isResolved: false, type: { in: [AlertType.NEARLY_FULL, AlertType.CRITICAL] } }
    });
    if (activeFill5.length !== 1 || activeFill5[0].type !== AlertType.NEARLY_FULL || activeFill5[0].severity !== AlertSeverity.WARNING) {
      throw new Error('Step 5 Failed: Expected exactly 1 active fill alert (NEARLY_FULL, WARNING)');
    }
    await verifyHardwareAlertsUntouched();
    console.log('  -> Step 5 PASS: 75% -> Resolves previous CRITICAL, establishes NEARLY_FULL (WARNING)');

    // Step 6: 45% -> Giải quyết toàn bộ cảnh báo mức đầy
    const alertStep6 = await updateFillAlert(testBinId, testBinCode, 45);
    if (alertStep6 !== null) {
      throw new Error(`Step 6 Failed: Expected null for 45%, got ${JSON.stringify(alertStep6)}`);
    }
    const activeFill6 = await prisma.alert.findMany({
      where: { binId: testBinId, isResolved: false, type: { in: [AlertType.NEARLY_FULL, AlertType.CRITICAL] } }
    });
    if (activeFill6.length !== 0) {
      throw new Error(`Step 6 Failed: Expected 0 active fill alerts, found ${activeFill6.length}`);
    }
    const oldStep5 = await prisma.alert.findUnique({ where: { id: alertStep5.id } });
    if (!oldStep5 || !oldStep5.isResolved || !oldStep5.resolvedAt) {
      throw new Error('Step 6 Failed: NEARLY_FULL alert from step 5 was not marked as resolved!');
    }
    await verifyHardwareAlertsUntouched();
    console.log('  -> Step 6 PASS: 45% -> Resolves all active fill alerts; hardware alerts remain untouched\n');

    // Dọn dẹp dữ liệu test
    await prisma.alert.deleteMany({ where: { binId: testBinId } });
    await prisma.bin.deleteMany({ where: { id: testBinId } });

    console.log('=== ALL SETTINGS THRESHOLD INTEGRATION TESTS PASSED CLEANLY (12/12) ===\n');
  } finally {
    if (clientA) clientA.disconnect();
    if (clientB) clientB.disconnect();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

runSettingsTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
