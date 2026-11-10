/**
 * Test suite verifying Production Collection Root Causes and Mandatory Requirements:
 * 1. resolveStationBins() resolves Station A bins with stationId = null (Production PostgreSQL scenario).
 * 2. resolveStationBins() does NOT contaminate Station A with Station B bins.
 * 3. resolveStationBins() does NOT fallback to allBins (returns null if station cannot be resolved).
 * 4. Idempotency: Re-sending exact same eventId for OPEN returns DUPLICATE_IGNORED without duplicate DB records.
 * 5. Idempotency: Re-sending exact same eventId for CLOSE returns DUPLICATE_IGNORED without duplicate DB records.
 * 6. Two consecutive cycles produce exactly 2 distinct CollectionRecord rows in DB.
 */

import assert from 'node:assert';
import { CollectionSessionService } from './collection-session.service.js';
import { prisma } from '../lib/prisma.js';

interface FakeBin {
  id: string;
  binCode: string;
  name: string;
  stationId: string | null;
  currentFillLevel: number | null;
  station?: any;
}

interface FakeRecord {
  id: string;
  binId: string;
  collectedBy: string | null;
  collectedAt: Date;
  fillLevelBefore: number;
  fillLevelAfter: number | null;
  status: string;
  notes: string | null;
  createdAt: Date;
}

function setupMockDb() {
  const stations = [
    { id: 'station_a_canonical_id', code: 'STATION_A', name: 'Trạm A (Thực tế)' },
    { id: 'station_b_canonical_id', code: 'STATION_B', name: 'Trạm B (Mô phỏng)' }
  ];

  // Production state: Station A bins have stationId = null!
  const bins: FakeBin[] = [
    { id: 'bin_a_rec', binCode: 'RECYCLABLE', name: 'Tái chế Trạm A', stationId: null, currentFillLevel: 55 },
    { id: 'bin_a_non', binCode: 'NON_RECYCLABLE', name: 'Vô cơ Trạm A', stationId: null, currentFillLevel: 60 },
    { id: 'bin_a_org', binCode: 'ORGANIC', name: 'Hữu cơ Trạm A', stationId: null, currentFillLevel: 45 },
    { id: 'bin_b_rec', binCode: 'RECYCLABLE', name: 'Tái chế Trạm B', stationId: 'station_b_canonical_id', currentFillLevel: 20 },
    { id: 'bin_b_non', binCode: 'NON_RECYCLABLE', name: 'Vô cơ Trạm B', stationId: 'station_b_canonical_id', currentFillLevel: 25 },
    { id: 'bin_b_org', binCode: 'ORGANIC', name: 'Hữu cơ Trạm B', stationId: 'station_b_canonical_id', currentFillLevel: 30 }
  ];

  const collectionRecords: FakeRecord[] = [];

  (prisma as any).$transaction = async (callback: any) => {
    return await callback(prisma);
  };

  (prisma as any).station = {
    findUnique: async ({ where }: any) => {
      const found = stations.find((s) => s.code === where.code || s.id === where.id);
      if (!found) return null;
      // Bins relation for Station A is empty because bin.stationId is null in production
      const relatedBins = bins.filter((b) => b.stationId === found.id);
      return {
        ...found,
        bins: relatedBins
      };
    }
  };

  (prisma as any).bin = {
    findMany: async ({ where }: any) => {
      if (where && where.OR) {
        return bins.filter((bin) => {
          return where.OR.some((cond: any) => {
            if (cond.stationId === null && bin.stationId === null) return true;
            if (cond.stationId && bin.stationId === cond.stationId) return true;
            if (cond.station?.code && bin.station?.code === cond.station.code) return true;
            return false;
          });
        });
      }
      return bins;
    },
    updateMany: async ({ where, data }: any) => {
      const targetIds = new Set(where.id?.in || []);
      let count = 0;
      for (const b of bins) {
        if (targetIds.has(b.id)) {
          if (typeof data.currentFillLevel === 'number') {
            b.currentFillLevel = data.currentFillLevel;
          }
          count++;
        }
      }
      return { count };
    }
  };

  (prisma as any).collectionRecord = {
    findMany: async ({ where }: any) => {
      let results = [...collectionRecords];
      if (where && where.OR) {
        results = results.filter((r) => {
          return where.OR.some((cond: any) => {
            if (cond.id && r.id === cond.id) return true;
            if (cond.collectedBy && r.collectedBy === cond.collectedBy) return true;
            if (cond.notes?.contains && r.notes?.includes(cond.notes.contains)) return true;
            return false;
          });
        });
      }
      return results;
    },
    findUnique: async ({ where }: any) => {
      return collectionRecords.find((r) => r.id === where.id) || null;
    },
    findFirst: async ({ where }: any) => {
      if (where && where.OR) {
        return collectionRecords.find((r) => {
          return where.OR.some((cond: any) => {
            if (cond.id && r.id === cond.id) return true;
            if (cond.notes?.contains && r.notes?.includes(cond.notes.contains)) return true;
            return false;
          });
        }) || null;
      }
      return collectionRecords[0] || null;
    },
    create: async ({ data }: any) => {
      const rec: FakeRecord = {
        ...data,
        createdAt: new Date()
      };
      collectionRecords.push(rec);
      return rec;
    },
    update: async ({ where, data }: any) => {
      const idx = collectionRecords.findIndex((r) => r.id === where.id);
      if (idx === -1) throw new Error('Record not found');
      collectionRecords[idx] = {
        ...collectionRecords[idx],
        ...data
      };
      return collectionRecords[idx];
    }
  };

  return { bins, collectionRecords };
}

async function runTests() {
  console.log('=== TEST SUITE: PRODUCTION COLLECTION FIX & IDEMPOTENCY ===\n');

  // Test 1: resolveStationBins handles Station A bins where stationId = null
  {
    setupMockDb();
    const service = new CollectionSessionService();
    const resA = await service.resolveStationBins('station_a');
    assert.ok(resA, 'Should resolve Station A bins');
    assert.strictEqual(resA.bins.length, 3, 'Station A must have exactly 3 bins');
    assert.strictEqual(resA.stationCode, 'STATION_A');
    const binIds = resA.bins.map((b) => b.id);
    assert.deepStrictEqual(binIds.sort(), ['bin_a_non', 'bin_a_org', 'bin_a_rec']);
    console.log('PASS [1]: resolveStationBins resolves Station A with stationId = null');
  }

  // Test 2: resolveStationBins for Station B does NOT include Station A bins
  {
    setupMockDb();
    const service = new CollectionSessionService();
    const resB = await service.resolveStationBins('station_b');
    assert.ok(resB, 'Should resolve Station B bins');
    assert.strictEqual(resB.bins.length, 3, 'Station B must have exactly 3 bins');
    assert.strictEqual(resB.stationCode, 'STATION_B');
    const binIds = resB.bins.map((b) => b.id);
    assert.deepStrictEqual(binIds.sort(), ['bin_b_non', 'bin_b_org', 'bin_b_rec']);
    // Ensure no null stationId bins were included in Station B
    assert.ok(resB.bins.every((b) => b.id.startsWith('bin_b_')));
    console.log('PASS [2]: resolveStationBins for Station B does NOT include Station A bins');
  }

  // Test 3: No allBins fallback - returns null if station cannot be resolved
  {
    setupMockDb();
    (prisma as any).station = { findUnique: async () => null };
    (prisma as any).bin = { findMany: async () => [] };
    const service = new CollectionSessionService();
    const resUnknown = await service.resolveStationBins('non_existent_station');
    assert.strictEqual(resUnknown, null, 'Must return null, NEVER fallback to allBins');
    console.log('PASS [3]: Returns null instead of falling back to allBins when station not found');
  }

  // Test 4: Idempotency - OPEN event resent due to lost ACK
  {
    const { collectionRecords } = setupMockDb();
    const service = new CollectionSessionService();

    // First ingestion of OPEN
    const res1 = await service.ingestEvent({
      eventId: 'evt-open-101',
      sessionId: 'sess-101',
      stationId: 'station_a',
      triggerSource: 'PHYSICAL_BUTTON',
      eventType: 'OPEN',
      occurredAt: new Date().toISOString()
    });

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.status, 'OPENED_SAVED');
    assert.strictEqual(collectionRecords.length, 1);

    // Client timed out waiting for ACK and resends exact same event
    const res2 = await service.ingestEvent({
      eventId: 'evt-open-101',
      sessionId: 'sess-101',
      stationId: 'station_a',
      triggerSource: 'PHYSICAL_BUTTON',
      eventType: 'OPEN',
      occurredAt: new Date().toISOString()
    });

    assert.strictEqual(res2.success, true, 'Resending committed OPEN must return success=true');
    assert.strictEqual(res2.status, 'DUPLICATE_IGNORED');
    assert.strictEqual(res2.duplicate, true);
    assert.strictEqual(collectionRecords.length, 1, 'MUST NOT create duplicate DB record');
    console.log('PASS [4]: Resending OPEN due to lost ACK returns DUPLICATE_IGNORED with 0 duplicate records');
  }

  // Test 5: Idempotency - CLOSE event resent due to lost ACK
  {
    const { bins, collectionRecords } = setupMockDb();
    const service = new CollectionSessionService();

    // Open session
    await service.ingestEvent({
      eventId: 'evt-open-202',
      sessionId: 'sess-202',
      stationId: 'station_a',
      triggerSource: 'PHYSICAL_BUTTON',
      eventType: 'OPEN',
      occurredAt: new Date().toISOString()
    });

    // Ingest CLOSE for the first time
    const resClose1 = await service.ingestEvent({
      eventId: 'evt-close-202',
      sessionId: 'sess-202',
      stationId: 'station_a',
      triggerSource: 'PHYSICAL_BUTTON',
      eventType: 'CLOSE',
      occurredAt: new Date().toISOString()
    });

    assert.strictEqual(resClose1.success, true);
    assert.strictEqual(resClose1.status, 'CLOSED_SAVED');
    assert.strictEqual(collectionRecords[0].status, 'COMPLETED');
    assert.strictEqual(bins.find((b) => b.id === 'bin_a_rec')?.currentFillLevel, 0);
    assert.strictEqual(bins.find((b) => b.id === 'bin_a_non')?.currentFillLevel, 0);
    assert.strictEqual(bins.find((b) => b.id === 'bin_a_org')?.currentFillLevel, 0);

    // Client resends exact same CLOSE event because ACK was lost in transit
    const resClose2 = await service.ingestEvent({
      eventId: 'evt-close-202',
      sessionId: 'sess-202',
      stationId: 'station_a',
      triggerSource: 'PHYSICAL_BUTTON',
      eventType: 'CLOSE',
      occurredAt: new Date().toISOString()
    });

    assert.strictEqual(resClose2.success, true, 'Resending committed CLOSE must return success=true');
    assert.strictEqual(resClose2.status, 'DUPLICATE_IGNORED');
    assert.strictEqual(resClose2.duplicate, true);
    assert.strictEqual(collectionRecords.length, 1, 'Total records must remain 1');
    console.log('PASS [5]: Resending CLOSE due to lost ACK returns DUPLICATE_IGNORED with 0 duplicate records');
  }

  // Test 6: Two consecutive cycles produce exactly 2 distinct CollectionRecords
  {
    const { collectionRecords } = setupMockDb();
    const service = new CollectionSessionService();

    // Cycle 1
    await service.ingestEvent({
      eventId: 'c1-open-evt',
      sessionId: 'c1-session-id',
      stationId: 'station_a',
      triggerSource: 'PHYSICAL_BUTTON',
      eventType: 'OPEN',
      occurredAt: new Date().toISOString()
    });
    await service.ingestEvent({
      eventId: 'c1-close-evt',
      sessionId: 'c1-session-id',
      stationId: 'station_a',
      triggerSource: 'PHYSICAL_BUTTON',
      eventType: 'CLOSE',
      occurredAt: new Date().toISOString()
    });

    // Cycle 2
    await service.ingestEvent({
      eventId: 'c2-open-evt',
      sessionId: 'c2-session-id',
      stationId: 'station_a',
      triggerSource: 'PHYSICAL_BUTTON',
      eventType: 'OPEN',
      occurredAt: new Date().toISOString()
    });
    await service.ingestEvent({
      eventId: 'c2-close-evt',
      sessionId: 'c2-session-id',
      stationId: 'station_a',
      triggerSource: 'PHYSICAL_BUTTON',
      eventType: 'CLOSE',
      occurredAt: new Date().toISOString()
    });

    assert.strictEqual(collectionRecords.length, 2);
    assert.strictEqual(collectionRecords[0].id, 'c1-session-id');
    assert.strictEqual(collectionRecords[0].status, 'COMPLETED');
    assert.strictEqual(collectionRecords[1].id, 'c2-session-id');
    assert.strictEqual(collectionRecords[1].status, 'COMPLETED');
    console.log('PASS [6]: Two consecutive cycles create exactly 2 distinct completed CollectionRecords');
  }

  console.log('\n=== ALL PRODUCTION COLLECTION FIX & IDEMPOTENCY TESTS PASSED ===');
}

runTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
