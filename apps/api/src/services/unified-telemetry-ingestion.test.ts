import assert from 'node:assert';
import crypto from 'node:crypto';
import { UnifiedTelemetryIngestionService, type IngestionPacket } from './unified-telemetry-ingestion.service.js';
import { prisma } from '../lib/prisma.js';

// Setup Mock Prisma for in-memory execution without touching remote PostgreSQL
function setupMockPrisma() {
  const stations: any[] = [
    { id: 'station-a-id', code: 'STATION_A', name: 'Trạm A', isActive: true, status: 'ONLINE' },
    { id: 'station-b-id', code: 'STATION_B', name: 'Trạm B', isActive: true, status: 'OFFLINE' }
  ];

  const bins: any[] = [
    // Station A: 3 compartments installed
    { id: 'bin-a-rec', stationId: 'station-a-id', binCode: 'RECYCLABLE', installed: true, isActive: true, currentFillLevel: 50, status: 'ONLINE' },
    { id: 'bin-a-non', stationId: 'station-a-id', binCode: 'NON_RECYCLABLE', installed: true, isActive: true, currentFillLevel: 40, status: 'ONLINE' },
    { id: 'bin-a-org', stationId: 'station-a-id', binCode: 'ORGANIC', installed: true, isActive: true, currentFillLevel: 30, status: 'ONLINE' },
    // Station B: ONLY RECYCLABLE installed; others NOT_INSTALLED
    { id: 'bin-b-rec', stationId: 'station-b-id', binCode: 'RECYCLABLE', installed: true, isActive: true, currentFillLevel: null, status: 'MAINTENANCE' },
    { id: 'bin-b-non', stationId: 'station-b-id', binCode: 'NON_RECYCLABLE', installed: false, isActive: true, currentFillLevel: null, status: 'MAINTENANCE' },
    { id: 'bin-b-org', stationId: 'station-b-id', binCode: 'ORGANIC', installed: false, isActive: true, currentFillLevel: null, status: 'MAINTENANCE' }
  ];

  const watermarks = new Map<string, any>();
  const ledger = new Map<string, any>();
  const sensorReadings: any[] = [];
  const alerts: any[] = [];

  const mockDb = {
    station: {
      findUnique: async ({ where }: any) => stations.find((s) => s.code === where.code) || null
    },
    bin: {
      findFirst: async ({ where }: any) => {
        return bins.find((b) => b.stationId === where.stationId && b.binCode === where.binCode && b.isActive === where.isActive) || null;
      },
      update: async ({ where, data }: any) => {
        const bin = bins.find((b) => b.id === where.id);
        if (bin) Object.assign(bin, data);
        return bin;
      }
    },
    stationWatermark: {
      findUnique: async ({ where }: any) => {
        if (where.id) {
          for (const v of watermarks.values()) {
            if (v.id === where.id) return v;
          }
          return null;
        }
        const key = `${where.stationCode_binCode.stationCode}_${where.stationCode_binCode.binCode}`;
        return watermarks.get(key) || null;
      },
      create: async ({ data }: any) => {
        const id = `wm-${Date.now()}-${Math.random()}`;
        const key = `${data.stationCode}_${data.binCode}`;
        const record = { id, ...data };
        watermarks.set(key, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        let record: any = null;
        let foundKey: string | null = null;
        if (where.id) {
          for (const [k, v] of watermarks.entries()) {
            if (v.id === where.id) {
              record = v;
              foundKey = k;
              break;
            }
          }
        } else if (where.stationCode_binCode) {
          foundKey = `${where.stationCode_binCode.stationCode}_${where.stationCode_binCode.binCode}`;
          record = watermarks.get(foundKey);
        }
        if (record && foundKey) {
          const updated = { ...record, ...data };
          watermarks.set(foundKey, updated);
          return updated;
        }
        return record;
      }
    },
    telemetryIdempotencyLedger: {
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
          const updated = { ...existing, ...update };
          ledger.set(key, updated);
          return updated;
        } else {
          ledger.set(key, { ...create });
          return create;
        }
      }
    },
    sensorReading: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const r = { id: `sr-${Date.now()}-${Math.random()}`, ...data };
        sensorReadings.push(r);
        return r;
      }
    },
    alert: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const a = { id: `al-${Date.now()}`, ...data };
        alerts.push(a);
        return a;
      },
      updateMany: async () => ({ count: 0 }),
      update: async ({ where, data }: any) => {
        const a = alerts.find((item) => item.id === where.id);
        if (a) Object.assign(a, data);
        return a;
      }
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(mockDb)
  };

  // Monkey patch global prisma for the scope of this test
  Object.assign(prisma, mockDb);

  return { stations, bins, watermarks, ledger, sensorReadings, alerts };
}

async function runUnifiedIngestionTests() {
  console.log('=== RUNNING UNIFIED TELEMETRY INGESTION SERVICE TESTS ===\n');
  const mockState = setupMockPrisma();
  const service = new UnifiedTelemetryIngestionService();

  // ----------------------------------------------------
  // TEST 1: Station Isolation (Station A vs Station B)
  // ----------------------------------------------------
  console.log('Test 1: Ingesting Station A does NOT affect Station B');
  const packetA: IngestionPacket = {
    stationCode: 'STATION_A',
    binCode: 'RECYCLABLE',
    fillLevel: 65,
    distanceCm: 18.0,
    sensorStatus: 'OK',
    isLegacy: true,
    clientMessageId: 'msg-test-a-1'
  };
  const resA = await service.ingest(packetA);
  assert.strictEqual(resA.accepted, true);
  assert.strictEqual(resA.status, 'ACCEPTED_IN_ORDER');

  const binARec = mockState.bins.find((b) => b.stationId === 'station-a-id' && b.binCode === 'RECYCLABLE');
  const binBRec = mockState.bins.find((b) => b.stationId === 'station-b-id' && b.binCode === 'RECYCLABLE');
  assert.strictEqual(binARec?.currentFillLevel, 65, 'Station A Recyclable updated to 65%');
  assert.strictEqual(binBRec?.currentFillLevel, null, 'Station B Recyclable must remain untouched (null)');
  console.log('  -> PASS: Station A and Station B isolated cleanly\n');

  // ----------------------------------------------------
  // TEST 2: Station B NOT_INSTALLED Protection
  // ----------------------------------------------------
  console.log('Test 2: Station B uninstalled compartments (NON_RECYCLABLE) are rejected without DB writes');
  const initialReadingsCount = mockState.sensorReadings.length;
  const packetBUninstalled: IngestionPacket = {
    stationCode: 'STATION_B',
    binCode: 'NON_RECYCLABLE',
    fillLevel: 75,
    distanceCm: 12.0,
    sensorStatus: 'NOT_INSTALLED',
    bootCount: 1n,
    bootId: 'boot-esp32c6-01',
    sampleSeq: 10
  };
  const resBUninstalled = await service.ingest(packetBUninstalled);
  assert.strictEqual(resBUninstalled.accepted, true);
  assert.strictEqual(resBUninstalled.status, 'SKIPPED_NOT_INSTALLED');
  assert.strictEqual(mockState.sensorReadings.length, initialReadingsCount, 'No SensorReading inserted for uninstalled compartment');
  const binBNon = mockState.bins.find((b) => b.stationId === 'station-b-id' && b.binCode === 'NON_RECYCLABLE');
  assert.strictEqual(binBNon?.currentFillLevel, null, 'Uninstalled bin currentFillLevel remains null');
  console.log('  -> PASS: Uninstalled compartment strictly skipped without sensor reading insertion\n');

  // ----------------------------------------------------
  // TEST 3: Strict Mode In-Order Ingestion (Station B Recyclable)
  // ----------------------------------------------------
  console.log('Test 3: Station B installed compartment in-order packet ingestion');
  const hashB1 = service.computePayloadHash({
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 42,
    distanceCm: 25.0,
    sensorStatus: 'OK'
  });
  const packetB1: IngestionPacket = {
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 42,
    distanceCm: 25.0,
    sensorStatus: 'OK',
    bootCount: 1n,
    bootId: 'boot-esp32c6-01',
    sampleSeq: 1,
    payloadHash: hashB1
  };
  const resB1 = await service.ingest(packetB1);
  assert.strictEqual(resB1.accepted, true);
  assert.strictEqual(resB1.status, 'ACCEPTED_IN_ORDER');
  assert.strictEqual(binBRec?.currentFillLevel, 42);
  assert.strictEqual(binBRec?.status, 'ONLINE');
  console.log('  -> PASS: First strict in-order packet accepted and bin brought ONLINE\n');

  // ----------------------------------------------------
  // TEST 4: Anti-Replay Fast ACK (Exact Duplicate)
  // ----------------------------------------------------
  console.log('Test 4: Anti-Replay Fast ACK on identical sequence and hash');
  const readingsBeforeDup = mockState.sensorReadings.length;
  const resB1Dup = await service.ingest(packetB1);
  assert.strictEqual(resB1Dup.accepted, true);
  assert.strictEqual(resB1Dup.status, 'FAST_ACK_DUPLICATE');
  assert.strictEqual(mockState.sensorReadings.length, readingsBeforeDup, 'No new sensor reading on duplicate');
  console.log('  -> PASS: Duplicate packet returned FAST_ACK_DUPLICATE without writes\n');

  // ----------------------------------------------------
  // TEST 5: Tamper Detection (Sequence Clash with Different Payload)
  // ----------------------------------------------------
  console.log('Test 5: Sequence clash with different payload triggers SEQUENCE_CLASH_TAMPERED');
  const hashTampered = service.computePayloadHash({
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 99, // Tampered fill level
    distanceCm: 2.0,
    sensorStatus: 'OK'
  });
  const packetTampered: IngestionPacket = {
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 99,
    distanceCm: 2.0,
    sensorStatus: 'OK',
    bootCount: 1n,
    bootId: 'boot-esp32c6-01',
    sampleSeq: 1, // Same sequence as packetB1!
    payloadHash: hashTampered
  };
  const resTampered = await service.ingest(packetTampered);
  assert.strictEqual(resTampered.accepted, false);
  assert.strictEqual(resTampered.status, 'SEQUENCE_CLASH_TAMPERED');
  assert.strictEqual(binBRec?.currentFillLevel, 42, 'Current fill level must NOT be modified by tampered packet');
  console.log('  -> PASS: Tampered sequence clash rejected cleanly\n');

  // ----------------------------------------------------
  // TEST 6: Hash Mismatch Detection
  // ----------------------------------------------------
  console.log('Test 6: Packet with manipulated hash mismatch is rejected');
  const packetBadHash: IngestionPacket = {
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 45,
    distanceCm: 24.0,
    sensorStatus: 'OK',
    bootCount: 1n,
    bootId: 'boot-esp32c6-01',
    sampleSeq: 2,
    payloadHash: 'deadbeefcafebabe0000111122223333444455556666777788889999aaaabbbb'
  };
  const resBadHash = await service.ingest(packetBadHash);
  assert.strictEqual(resBadHash.accepted, false);
  assert.strictEqual(resBadHash.status, 'HASH_MISMATCH');
  console.log('  -> PASS: Hash mismatch rejected before database access\n');

  // ----------------------------------------------------
  // TEST 7: In-Order Advancement to Sequence 5
  // ----------------------------------------------------
  console.log('Test 7: Advance sequence to 5');
  const hashB5 = service.computePayloadHash({
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 55,
    distanceCm: 20.0,
    sensorStatus: 'OK'
  });
  const packetB5: IngestionPacket = {
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 55,
    distanceCm: 20.0,
    sensorStatus: 'OK',
    bootCount: 1n,
    bootId: 'boot-esp32c6-01',
    sampleSeq: 5,
    payloadHash: hashB5
  };
  const resB5 = await service.ingest(packetB5);
  assert.strictEqual(resB5.accepted, true);
  assert.strictEqual(resB5.status, 'ACCEPTED_IN_ORDER');
  assert.strictEqual(binBRec?.currentFillLevel, 55);
  console.log('  -> PASS: Sequence advanced to 5, fill level updated to 55%\n');

  // ----------------------------------------------------
  // TEST 8: Out-of-Order Packet within Window (isLate = true)
  // ----------------------------------------------------
  console.log('Test 8: Out-of-order packet (seq=3, arrival within 60s) accepted as cold storage');
  const hashB3 = service.computePayloadHash({
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 48,
    distanceCm: 22.0,
    sensorStatus: 'OK'
  });
  const packetB3: IngestionPacket = {
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 48,
    distanceCm: 22.0,
    sensorStatus: 'OK',
    bootCount: 1n,
    bootId: 'boot-esp32c6-01',
    sampleSeq: 3, // seq 3 < lastSampleSeq 5
    payloadHash: hashB3,
    timestamp: new Date(Date.now() - 5000) // 5 seconds ago
  };
  const resB3 = await service.ingest(packetB3);
  assert.strictEqual(resB3.accepted, true);
  assert.strictEqual(resB3.status, 'ACCEPTED_LATE');
  assert.strictEqual(resB3.isLate, true);
  // Immutable invariant: Bin.currentFillLevel MUST NOT be overwritten by out-of-order packet
  assert.strictEqual(binBRec?.currentFillLevel, 55, 'Bin.currentFillLevel remains 55% from seq 5');
  // Watermark MUST NOT move backwards
  const wm = mockState.watermarks.get('STATION_B_RECYCLABLE');
  assert.strictEqual(wm?.lastSampleSeq, 5, 'Watermark remains at seq 5');
  console.log('  -> PASS: Out-of-order packet recorded with isLate=true without overwriting currentFillLevel\n');

  // ----------------------------------------------------
  // TEST 9: Reboot / NVS Reset Detection (bootCount Decreased)
  // ----------------------------------------------------
  console.log('Test 9: Reboot with decreased bootCount triggers COMMISSIONING_REQUIRED');
  const packetNvsReset: IngestionPacket = {
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    fillLevel: 50,
    distanceCm: 22.0,
    sensorStatus: 'OK',
    bootCount: 0n, // Decreased bootCount! (Current is 1n)
    bootId: 'boot-esp32c6-reset',
    sampleSeq: 1
  };
  const resReset = await service.ingest(packetNvsReset);
  assert.strictEqual(resReset.accepted, false);
  assert.strictEqual(resReset.status, 'COMMISSIONING_REQUIRED');
  const alert = mockState.alerts.find((a) => a.type === 'COMMISSIONING_REQUIRED');
  assert.ok(alert, 'Critical alert created in DB');
  console.log('  -> PASS: NVS reset detected and quarantined with COMMISSIONING_REQUIRED\n');

  console.log('===========================================================');
  console.log('ALL UNIFIED TELEMETRY INGESTION SERVICE TESTS PASSED (9/9)!');
  console.log('===========================================================');
}

runUnifiedIngestionTests().catch((err) => {
  console.error('TEST RUNNER FAILED:', err);
  process.exit(1);
});
