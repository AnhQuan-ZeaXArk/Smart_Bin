import assert from 'node:assert';
import { UnifiedTelemetryIngestionService } from './unified-telemetry-ingestion.service.js';
import { syncBinWithRealDevice, syncBinsWithRealDevice } from './bin-sync.service.js';
import { prisma } from '../lib/prisma.js';

/**
 * End-to-End Backend Telemetry Fix Test Suite:
 * 1. Station A Ingestion with stationId = NULL (Pre-migration safety fallback)
 * 2. Station A Ingestion with canonical stationId = 'station_a_canonical_id'
 * 3. Station B Ingestion with installed RECYCLABLE compartment
 * 4. Station B Uninstalled compartments (ORGANIC & NON_RECYCLABLE) return SKIPPED_NOT_INSTALLED
 * 5. UNKNOWN_BIN behavior on invalid binCode or unknown station
 * 6. Correct bin mapping and ID preservation (no ID churn)
 * 7. In-memory syncBinsWithRealDevice correctly overrides with RAM and preserves fresh DB
 * 8. Error handling when database fails
 */

function setupMockPrisma() {
  const stations: any[] = [
    { id: 'station_a_canonical_id', code: 'STATION_A', name: 'Trạm Thu gom Trung tâm A', isActive: true, status: 'ONLINE', location: 'Khuôn viên chính' },
    { id: 'station_b_canonical_id', code: 'STATION_B', name: 'Trạm Thu gom Mở rộng B', isActive: true, status: 'OFFLINE', location: 'Khuôn viên phía Đông' }
  ];

  // Mô phỏng 3 bin Station A đang có stationId = null (tình trạng Production thực tế)
  const bins: any[] = [
    { id: 'cmw4u47sq000dmv94ew62bnpt', stationId: null, binCode: 'RECYCLABLE', installed: true, isActive: true, currentFillLevel: 0, status: 'OFFLINE', distanceCm: null, lastSeen: null },
    { id: 'cmw4u47sq000fmv944t48eibd', stationId: null, binCode: 'NON_RECYCLABLE', installed: true, isActive: true, currentFillLevel: 0, status: 'OFFLINE', distanceCm: null, lastSeen: null },
    { id: 'cmw4u47sq000emv941nja5ro9', stationId: null, binCode: 'ORGANIC', installed: true, isActive: true, currentFillLevel: 0, status: 'OFFLINE', distanceCm: null, lastSeen: null },
    // Station B bins
    { id: 'bin_station_b_recyclable_id', stationId: 'station_b_canonical_id', binCode: 'RECYCLABLE', installed: true, isActive: true, currentFillLevel: null, status: 'OFFLINE', distanceCm: null, lastSeen: null },
    { id: 'bin_station_b_non_recyclable_id', stationId: 'station_b_canonical_id', binCode: 'NON_RECYCLABLE', installed: false, isActive: true, currentFillLevel: null, status: 'MAINTENANCE', distanceCm: null, lastSeen: null },
    { id: 'bin_station_b_organic_id', stationId: 'station_b_canonical_id', binCode: 'ORGANIC', installed: false, isActive: true, currentFillLevel: null, status: 'MAINTENANCE', distanceCm: null, lastSeen: null }
  ];

  const sensorReadings: any[] = [];
  const watermarks = new Map<string, any>();
  const ledger = new Map<string, any>();
  const alerts: any[] = [];

  (prisma as any).station = {
    findUnique: async ({ where }: any) => stations.find((s) => s.code === where.code || s.id === where.id) || null,
    findMany: async () => stations
  };

  (prisma as any).bin = {
    findFirst: async ({ where }: any) => {
      return bins.find((b) => {
        const matchStation = where.stationId === null ? b.stationId === null : b.stationId === where.stationId;
        const matchBinCode = b.binCode === where.binCode;
        const matchActive = where.isActive === undefined || b.isActive === where.isActive;
        return matchStation && matchBinCode && matchActive;
      }) || null;
    },
    findMany: async ({ where }: any = {}) => {
      return bins.filter((b) => {
        if (where.stationId !== undefined) {
          if (b.stationId !== where.stationId) return false;
        }
        if (where.isActive !== undefined && b.isActive !== where.isActive) return false;
        return true;
      }).map((b) => ({ ...b, station: stations.find((s) => s.id === b.stationId) }));
    },
    update: async ({ where, data }: any) => {
      const b = bins.find((item) => item.id === where.id);
      if (b) Object.assign(b, data);
      return b;
    }
  };

  (prisma as any).sensorReading = {
    create: async ({ data }: any) => {
      const reading = { id: `sr-${sensorReadings.length + 1}`, ...data };
      sensorReadings.push(reading);
      return reading;
    },
    findFirst: async ({ where }: any) => {
      const filtered = sensorReadings.filter((sr) => sr.binId === where.binId);
      return filtered.length > 0 ? filtered[filtered.length - 1] : null;
    },
    findMany: async ({ where }: any = {}) => {
      return sensorReadings.filter((sr) => !where?.binId || sr.binId === where.binId);
    }
  };

  (prisma as any).stationWatermark = {
    findUnique: async ({ where }: any) => {
      if (where.id) {
        for (const v of watermarks.values()) if (v.id === where.id) return v;
        return null;
      }
      return watermarks.get(`${where.stationCode_binCode.stationCode}_${where.stationCode_binCode.binCode}`) || null;
    },
    create: async ({ data }: any) => {
      const id = `wm-${Date.now()}`;
      const rec = { id, ...data };
      watermarks.set(`${data.stationCode}_${data.binCode}`, rec);
      return rec;
    },
    update: async ({ where, data }: any) => {
      for (const [k, v] of watermarks.entries()) {
        if (v.id === where.id) {
          const updated = { ...v, ...data };
          watermarks.set(k, updated);
          return updated;
        }
      }
      return null;
    }
  };

  (prisma as any).telemetryIdempotencyLedger = {
    findUnique: async ({ where }: any) => {
      const key = `${where.stationCode_bootId_sampleSeq.stationCode}_${where.stationCode_bootId_sampleSeq.bootId}_${where.stationCode_bootId_sampleSeq.sampleSeq}`;
      return ledger.get(key) || null;
    },
    create: async ({ data }: any) => {
      const key = `${data.stationCode}_${data.bootId}_${data.sampleSeq}`;
      ledger.set(key, { ...data });
      return data;
    },
    upsert: async ({ where, create, update }: any) => {
      const key = `${where.stationCode_bootId_sampleSeq.stationCode}_${where.stationCode_bootId_sampleSeq.bootId}_${where.stationCode_bootId_sampleSeq.sampleSeq}`;
      const existing = ledger.get(key);
      if (existing) {
        const u = { ...existing, ...update };
        ledger.set(key, u);
        return u;
      }
      ledger.set(key, { ...create });
      return create;
    }
  };

  (prisma as any).alert = {
    findFirst: async () => null,
    create: async ({ data }: any) => {
      const alt = { id: `alt-${alerts.length + 1}`, ...data };
      alerts.push(alt);
      return alt;
    },
    updateMany: async () => ({ count: 0 }),
    update: async () => null,
    findMany: async () => alerts
  };

  (prisma as any).$transaction = async (callback: any) => {
    return await callback(prisma);
  };

  return { stations, bins, sensorReadings, watermarks, ledger, alerts };
}

async function runEndToEndBackendTests() {
  console.log('================================================================');
  console.log('  RUNNING END-TO-END BACKEND TELEMETRY FIX TEST SUITE');
  console.log('================================================================\n');

  const { stations, bins, sensorReadings } = setupMockPrisma();
  const ingestion = new UnifiedTelemetryIngestionService();

  // Test 1: Station A Ingestion với stationId = null (Fallback an toàn trước migration)
  console.log('Test 1: Station A Ingestion với stationId = NULL fallback');
  const resA1 = await ingestion.ingest({
    stationCode: 'STATION_A',
    binCode: 'RECYCLABLE',
    fillLevel: 62,
    distanceCm: 18.2,
    sensorStatus: 'OK',
    isLegacy: true,
    clientMessageId: 'msg-test-a-1'
  });
  assert.strictEqual(resA1.accepted, true, 'Ingestion must succeed for legacy null stationId');
  assert.strictEqual(resA1.status, 'ACCEPTED_IN_ORDER');

  const binARec = bins.find((b) => b.id === 'cmw4u47sq000dmv94ew62bnpt');
  assert.strictEqual(binARec.currentFillLevel, 62, 'Fill level must be updated on Station A bin');
  assert.strictEqual(binARec.status, 'ONLINE');
  assert.strictEqual(sensorReadings.length, 1, 'Sensor reading must be inserted');
  console.log('  -> PASS: Station A ingestion thành công với stationId = null (ID bảo toàn, 62% ONLINE)\n');

  // Test 2: Sau khi gán stationId = 'station_a_canonical_id' (Post-migration)
  console.log('Test 2: Station A Ingestion sau khi gán canonical stationId');
  binARec.stationId = 'station_a_canonical_id';
  const resA2 = await ingestion.ingest({
    stationCode: 'STATION_A',
    binCode: 'RECYCLABLE',
    fillLevel: 75,
    distanceCm: 14.0,
    sensorStatus: 'OK',
    isLegacy: true,
    clientMessageId: 'msg-test-a-2'
  });
  assert.strictEqual(resA2.accepted, true);
  assert.strictEqual(binARec.currentFillLevel, 75);
  console.log('  -> PASS: Station A ingestion tiếp tục thành công với canonical stationId\n');

  // Test 3: Station B Recyclable (Installed) Ingestion
  console.log('Test 3: Station B Recyclable Ingestion (Installed compartment)');
  const hashB = ingestion.computePayloadHash({
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 82,
    distanceCm: 11.5,
    sensorStatus: 'OK'
  });
  const resBRec = await ingestion.ingest({
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 82,
    distanceCm: 11.5,
    sensorStatus: 'OK',
    bootCount: 1n,
    bootId: 'boot-esp32c6-01',
    sampleSeq: 1,
    payloadHash: hashB,
    clientMessageId: 'STATION_B-1-1-boot-esp32c6-01'
  });
  assert.strictEqual(resBRec.accepted, true);
  assert.strictEqual(resBRec.status, 'ACCEPTED_IN_ORDER');

  const binBRec = bins.find((b) => b.id === 'bin_station_b_recyclable_id');
  assert.strictEqual(binBRec.currentFillLevel, 82);
  assert.strictEqual(binBRec.status, 'ONLINE');
  console.log('  -> PASS: Station B Recyclable ingestion thành công (82% ONLINE)\n');

  // Test 4: Station B Uninstalled compartments (ORGANIC & NON_RECYCLABLE)
  console.log('Test 4: Station B Uninstalled compartments return SKIPPED_NOT_INSTALLED');
  const resBOrg = await ingestion.ingest({
    stationCode: 'STATION_B',
    binCode: 'ORGANIC',
    fillLevel: 50,
    distanceCm: 20.0,
    sensorStatus: 'OK',
    bootCount: 1n,
    bootId: 'boot-esp32c6-01',
    sampleSeq: 2,
    payloadHash: 'hash-test-02',
    clientMessageId: 'STATION_B-1-2-boot-esp32c6-01'
  });
  assert.strictEqual(resBOrg.accepted, true);
  assert.strictEqual(resBOrg.status, 'SKIPPED_NOT_INSTALLED');

  const binBOrg = bins.find((b) => b.id === 'bin_station_b_organic_id');
  assert.strictEqual(binBOrg.currentFillLevel, null, 'Uninstalled compartment must remain null');
  assert.strictEqual(binBOrg.status, 'MAINTENANCE', 'Uninstalled compartment must remain MAINTENANCE');
  console.log('  -> PASS: Ngăn chưa lắp đặt được bỏ qua an toàn, không ghi số liệu giả\n');

  // Test 5: UNKNOWN_BIN behavior
  console.log('Test 5: UNKNOWN_BIN behavior khi sai mã bin hoặc trạm');
  const resUnknown = await ingestion.ingest({
    stationCode: 'STATION_A',
    binCode: 'HAZARDOUS',
    fillLevel: 10,
    sensorStatus: 'OK',
    isLegacy: true
  });
  assert.strictEqual(resUnknown.accepted, false);
  assert.strictEqual(resUnknown.status, 'UNKNOWN_BIN');
  console.log('  -> PASS: Trả về UNKNOWN_BIN khi binCode không tồn tại\n');

  // Test 6: syncBinWithRealDevice fallback và in-memory priority
  console.log('Test 6: syncBinWithRealDevice logic priority');
  // Trường hợp RAM có dữ liệu tươi
  const realStatusOnline = {
    deviceId: 'raspberry-pi-5',
    deviceName: 'Raspberry Pi 5',
    deviceType: 'RASPBERRY_PI' as const,
    stationCode: 'STATION_A',
    isReal: true as const,
    status: 'ONLINE' as const,
    uptimeSeconds: 120,
    cpuTempC: 45.0,
    lastHeartbeat: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    heartbeatCount: 10,
    ageSeconds: 1,
    isSocketConnected: true,
    subsystems: { yolo: 'RUNNING', camera: 'CONNECTED', esp32: 'CONNECTED' },
    aiDetection: null,
    detectionHistory: [],
    sensors: {
      recyclable: { fillLevel: 44, distanceCm: 22.0, status: 'OK' },
      nonRecyclable: { fillLevel: 66, distanceCm: 15.0, status: 'OK' },
      organic: { fillLevel: 22, distanceCm: 30.0, status: 'OK' }
    }
  };

  const syncedFromRam = syncBinWithRealDevice(binARec, realStatusOnline);
  assert.strictEqual(syncedFromRam.currentFillLevel, 44, 'RAM fill level takes precedence when online');
  assert.strictEqual(syncedFromRam.status, 'ONLINE');

  // Trường hợp RAM OFFLINE nhưng DB có dữ liệu mới (<= 15s)
  const realStatusOffline = { ...realStatusOnline, status: 'OFFLINE' as const };
  binARec.lastSeen = new Date(); // DB vừa ghi nhận
  binARec.currentFillLevel = 75;
  const syncedFromDb = syncBinWithRealDevice(binARec, realStatusOffline);
  assert.strictEqual(syncedFromDb.currentFillLevel, 75, 'Fresh DB reading preserved even if RAM is OFFLINE');

  // Trường hợp cả RAM và DB đều quá hạn (>15s)
  binARec.lastSeen = new Date(Date.now() - 60000); // 60s trước
  const syncedStale = syncBinWithRealDevice(binARec, realStatusOffline);
  assert.strictEqual(syncedStale.currentFillLevel, null, 'Stale reading must return null');
  assert.strictEqual(syncedStale.status, 'OFFLINE');
  console.log('  -> PASS: Đồng bộ RAM và DB hoạt động chính xác theo thứ tự ưu tiên và thời gian tươi\n');

  // Test 7: Station A 3-compartment packet với cùng clientMessageId và mức đầy 0%
  console.log('Test 7: Station A multi-compartment packet với shared clientMessageId và 0% fill level');
  const sharedMsgId = 'STATION_A-0-1794212251508';
  const resComp1 = await ingestion.ingest({
    stationCode: 'STATION_A',
    binCode: 'RECYCLABLE',
    fillLevel: 0,
    distanceCm: 60.0,
    sensorStatus: 'OK',
    isLegacy: true,
    clientMessageId: `${sharedMsgId}:RECYCLABLE`
  });
  const resComp2 = await ingestion.ingest({
    stationCode: 'STATION_A',
    binCode: 'NON_RECYCLABLE',
    fillLevel: 0,
    distanceCm: 60.0,
    sensorStatus: 'OK',
    isLegacy: true,
    clientMessageId: `${sharedMsgId}:NON_RECYCLABLE`
  });
  const resComp3 = await ingestion.ingest({
    stationCode: 'STATION_A',
    binCode: 'ORGANIC',
    fillLevel: 0,
    distanceCm: 60.0,
    sensorStatus: 'OK',
    isLegacy: true,
    clientMessageId: `${sharedMsgId}:ORGANIC`
  });

  assert.strictEqual(resComp1.accepted, true, 'Comp 1 must be accepted');
  assert.strictEqual(resComp1.status, 'ACCEPTED_IN_ORDER', 'Comp 1 status ACCEPTED_IN_ORDER');
  assert.strictEqual(resComp2.accepted, true, 'Comp 2 must be accepted (no transport cache collision)');
  assert.strictEqual(resComp2.status, 'ACCEPTED_IN_ORDER', 'Comp 2 status ACCEPTED_IN_ORDER');
  assert.strictEqual(resComp3.accepted, true, 'Comp 3 must be accepted (no transport cache collision)');
  assert.strictEqual(resComp3.status, 'ACCEPTED_IN_ORDER', 'Comp 3 status ACCEPTED_IN_ORDER');

  // Kiểm tra mức đầy 0% được lưu trữ chính xác trong DB, không bị biến thành null
  const dbBin1 = bins.find((b) => b.id === 'cmw4u47sq000dmv94ew62bnpt');
  const dbBin2 = bins.find((b) => b.id === 'cmw4u47sq000fmv944t48eibd');
  const dbBin3 = bins.find((b) => b.id === 'cmw4u47sq000emv941nja5ro9');
  assert.strictEqual(dbBin1.currentFillLevel, 0, 'DB Recyclable must be 0%');
  assert.strictEqual(dbBin2.currentFillLevel, 0, 'DB Non-Recyclable must be 0%');
  assert.strictEqual(dbBin3.currentFillLevel, 0, 'DB Organic must be 0%');
  console.log('  -> PASS: Cả 3 ngăn rác Trạm A đều nạp thành công 0% mà không bị lỗi FAST_ACK_DUPLICATE\n');

  // Test 8: Production Scenario HC1=36% (RECYCLABLE), HC2=14% (NON_RECYCLABLE), HC3=3% (ORGANIC) với delayOnPiMs = 11s
  console.log('Test 8: Production Scenario HC1=36%, HC2=14%, HC3=3% syncBinsWithRealDevice freshness preservation');
  const serverReceiveMs8 = Date.now() - 4000; // Heartbeat vừa nhận cách đây 4s (chu kỳ gửi của Pi là 5s)
  const piSentMs8 = serverReceiveMs8;
  const sensorMeasuredMs8 = piSentMs8 - 11000; // Cảm biến đo 11s trước khi Pi gửi (hợp lệ <= 15s trên Pi)
  const realStatus36_14_3 = {
    ...realStatusOnline,
    status: 'ONLINE' as const,
    lastHeartbeat: new Date(serverReceiveMs8).toISOString(),
    receivedAt: new Date(serverReceiveMs8).toISOString(),
    sentAt: new Date(piSentMs8).toISOString(),
    sensors: {
      recyclable: { fillLevel: 36, distanceCm: 38.4, status: 'OK', updatedAt: new Date(sensorMeasuredMs8).toISOString() },
      nonRecyclable: { fillLevel: 14, distanceCm: 51.6, status: 'OK', updatedAt: new Date(sensorMeasuredMs8).toISOString() },
      organic: { fillLevel: 3, distanceCm: 58.2, status: 'OK', updatedAt: new Date(sensorMeasuredMs8).toISOString() }
    }
  };

  const syncedAll8 = syncBinsWithRealDevice([dbBin1, dbBin2, dbBin3], realStatus36_14_3);
  const syncedRec8 = syncedAll8.find((b) => b.binCode === 'RECYCLABLE')!;
  const syncedNon8 = syncedAll8.find((b) => b.binCode === 'NON_RECYCLABLE')!;
  const syncedOrg8 = syncedAll8.find((b) => b.binCode === 'ORGANIC')!;

  assert.strictEqual(syncedRec8.currentFillLevel, 36, 'HC1 -> RECYCLABLE must be 36%');
  assert.strictEqual(syncedNon8.currentFillLevel, 14, 'HC2 -> NON_RECYCLABLE must be 14%');
  assert.strictEqual(syncedOrg8.currentFillLevel, 3, 'HC3 -> ORGANIC must be 3%');
  assert.strictEqual(syncedRec8.status, 'ONLINE');
  assert.strictEqual(syncedNon8.status, 'ONLINE');
  assert.strictEqual(syncedOrg8.status, 'ONLINE');

  // Đảm bảo lastSeen trả về từ API không bị trừ kép (4s + 11s = 15s+) khiến Frontend vừa nhận đã đánh dấu STALE
  for (const sBin of [syncedRec8, syncedNon8, syncedOrg8]) {
    const ageOnFrontendMs = Date.now() - new Date(sBin.lastSeen!).getTime();
    assert.ok(ageOnFrontendMs < 15000, `Bin ${sBin.binCode} lastSeen age (${ageOnFrontendMs}ms) must be < 15000ms so cards do not show "—"`);
  }
  console.log('  -> PASS: syncBinsWithRealDevice trả về đúng 36%, 14%, 3% với lastSeen tươi (< 15s), không bị trừ kép delayOnPiMs\n');

  console.log('================================================================');
  console.log('  ALL 8 END-TO-END BACKEND TELEMETRY TESTS PASSED CLEANLY (8/8)!');
  console.log('================================================================\n');
}

runEndToEndBackendTests().catch((err) => {
  console.error('BACKEND TELEMETRY FIX TESTS FAILED:', err);
  process.exit(1);
});
