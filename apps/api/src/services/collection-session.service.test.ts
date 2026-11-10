import assert from 'node:assert';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { io as createClientSocket } from 'socket.io-client';
import {
  CollectionSessionService,
  serializeCollectionRecord
} from './collection-session.service.js';
import { RealtimeGateway, REALTIME_EVENTS } from '../integrations/realtime/realtime.gateway.js';
import { prisma } from '../lib/prisma.js';

function setupMockCollectionDatabase() {
  const stations: any[] = [
    {
      id: 'station_a_db_id',
      code: 'STATION_A',
      name: 'Trạm A',
      isActive: true,
      bins: [
        {
          id: 'bin_a_rec',
          stationId: 'station_a_db_id',
          binCode: 'RECYCLABLE',
          name: 'Thùng Rác Tái Chế Trạm A',
          currentFillLevel: null
        }
      ]
    }
  ];

  const collectionRecords: any[] = [];
  let shouldFailTransaction = false;

  (prisma as any).$transaction = async (callback: (tx: any) => Promise<any>) => {
    if (shouldFailTransaction) {
      throw new Error('Simulated database deadlock / constraint failure');
    }
    return await callback(prisma);
  };

  (prisma as any).station = {
    findUnique: async ({ where }: any) =>
      stations.find((s) => s.code === where.code || s.id === where.id) || null
  };

  (prisma as any).bin = {
    findFirst: async () => ({
      id: 'bin_a_rec',
      stationId: 'station_a_db_id',
      binCode: 'RECYCLABLE',
      name: 'Thùng Rác Tái Chế Trạm A',
      currentFillLevel: stations[0].bins[0].currentFillLevel,
      station: { code: 'STATION_A', name: 'Trạm A' }
    })
  };

  (prisma as any).collectionRecord = {
    findMany: async () => [...collectionRecords],
    findUnique: async ({ where }: any) =>
      collectionRecords.find((r) => r.id === where.id) || null,
    create: async ({ data }: any) => {
      if (shouldFailTransaction) {
        throw new Error('Simulated database deadlock / constraint failure');
      }
      const rec = {
        ...data,
        createdAt: new Date()
      };
      collectionRecords.unshift(rec);
      return rec;
    },
    update: async ({ where, data }: any) => {
      if (shouldFailTransaction) {
        throw new Error('Simulated database deadlock / constraint failure');
      }
      const idx = collectionRecords.findIndex((r) => r.id === where.id);
      if (idx === -1) throw new Error(`Record ${where.id} not found`);
      collectionRecords[idx] = {
        ...collectionRecords[idx],
        ...data
      };
      return collectionRecords[idx];
    }
  };

  return {
    collectionRecords,
    stations,
    setFailTransaction: (val: boolean) => {
      shouldFailTransaction = val;
    }
  };
}

async function runTests() {
  console.log('=== PHASE 1.1 TECHNICAL CORRECTION - BACKEND TESTS ===');

  const { collectionRecords, stations, setFailTransaction } = setupMockCollectionDatabase();
  const service = new CollectionSessionService();

  // 1. Open without sensor measurement: does NOT fake fillLevelBefore = 0 (DB = -1 sentinel, API = null)
  const session1 = crypto.randomUUID();
  const openEvent1 = crypto.randomUUID();
  const openTime1 = '2026-11-10T05:00:00.000Z';

  const openRes1 = await service.ingestEvent({
    eventId: openEvent1,
    sessionId: session1,
    stationId: 'station_a',
    triggerSource: 'PHYSICAL_BUTTON',
    eventType: 'OPEN',
    occurredAt: openTime1
  });

  assert.strictEqual(openRes1.success, true);
  assert.strictEqual(openRes1.status, 'OPENED_SAVED');
  assert.strictEqual(openRes1.session?.fillLevelBefore, null, 'fillLevelBefore must be null when unmeasured, NOT 0');
  assert.strictEqual(collectionRecords[0].fillLevelBefore, -1, 'DB column constraint requires integer: sentinel is -1, NOT 0');
  assert.strictEqual(collectionRecords[0].fillLevelAfter, null, 'Must not infer bin was emptied (fillLevelAfter is null)');

  const serialized1 = serializeCollectionRecord(collectionRecords[0]);
  assert.strictEqual(serialized1.fillLevelBefore, null, 'API serializer must expose null (never fake 0%)');
  console.log('PASS [1]: Open without sensor data does NOT assign 0% (DB sentinel -1, API/Frontend null)');

  // Close session 1 so station A is ready for next session
  await service.ingestEvent({
    eventId: crypto.randomUUID(),
    sessionId: session1,
    stationId: 'station_a',
    triggerSource: 'PHYSICAL_BUTTON',
    eventType: 'CLOSE',
    occurredAt: '2026-11-10T05:05:00.000Z'
  });

  // 2. Open with actual sensor measurement: accurately preserves measured fill percentage
  const session2 = crypto.randomUUID();
  const openEvent2 = crypto.randomUUID();
  const openTime2 = '2026-11-10T05:10:00.000Z';

  const openRes2 = await service.ingestEvent({
    eventId: openEvent2,
    sessionId: session2,
    stationId: 'station_a',
    triggerSource: 'PHYSICAL_BUTTON',
    eventType: 'OPEN',
    occurredAt: openTime2,
    fillPercent: 45
  });

  assert.strictEqual(openRes2.success, true);
  assert.strictEqual(openRes2.session?.fillLevelBefore, 45, 'Must preserve actual sensor measurement 45%');
  assert.strictEqual(collectionRecords[0].fillLevelBefore, 45);

  const serialized2 = serializeCollectionRecord(collectionRecords[0]);
  assert.strictEqual(serialized2.fillLevelBefore, 45);
  console.log('PASS [2]: Open with actual sensor data preserves real measurement (45%)');

  // 3. Duplicate OPEN while session is already open is rejected
  const dupOpenRes = await service.ingestEvent({
    eventId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    stationId: 'station_a',
    triggerSource: 'PHYSICAL_BUTTON',
    eventType: 'OPEN',
    occurredAt: '2026-11-10T05:11:00.000Z'
  });

  assert.strictEqual(dupOpenRes.success, false);
  assert.strictEqual(dupOpenRes.status, 'SESSION_ALREADY_OPEN');
  console.log('PASS [3]: Duplicate OPEN while a session is active is rejected');

  // 4. Idempotent re-send of same eventId does NOT create duplicate records
  const countBefore = collectionRecords.length;
  const retryRes = await service.ingestEvent({
    eventId: openEvent2,
    sessionId: session2,
    stationId: 'station_a',
    triggerSource: 'PHYSICAL_BUTTON',
    eventType: 'OPEN',
    occurredAt: openTime2,
    fillPercent: 45
  });

  assert.strictEqual(retryRes.success, true);
  assert.strictEqual(retryRes.status, 'DUPLICATE_IGNORED');
  assert.strictEqual(retryRes.duplicate, true);
  assert.strictEqual(collectionRecords.length, countBefore, 'Idempotent call must not insert duplicate record');
  console.log('PASS [4]: Re-sending exact same eventId is idempotent (no duplicate DB record)');

  // 5. Database transaction failure: Gateway/Service returns failure ACK with matching eventId
  setFailTransaction(true);
  const failEventId = crypto.randomUUID();
  const failSessionId = crypto.randomUUID();

  const failRes = await service.ingestEvent({
    eventId: failEventId,
    sessionId: failSessionId,
    stationId: 'station_a',
    triggerSource: 'PHYSICAL_BUTTON',
    eventType: 'CLOSE',
    occurredAt: '2026-11-10T05:12:00.000Z'
  });

  assert.strictEqual(failRes.success, false);
  assert.strictEqual(failRes.status, 'INGESTION_ERROR');
  assert.strictEqual(failRes.eventId, failEventId, 'Failure ACK must preserve matching eventId');
  setFailTransaction(false);
  console.log('PASS [5]: DB transaction failure returns success=false and matching eventId');

  // 6. CLOSE without a successful OPEN is rejected
  const orphanCloseEvent = crypto.randomUUID();
  const orphanSessionId = crypto.randomUUID();

  const orphanRes = await service.ingestEvent({
    eventId: orphanCloseEvent,
    sessionId: orphanSessionId,
    stationId: 'station_a',
    triggerSource: 'PHYSICAL_BUTTON',
    eventType: 'CLOSE',
    occurredAt: '2026-11-10T05:13:00.000Z'
  });

  assert.strictEqual(orphanRes.success, false);
  assert.strictEqual(orphanRes.status, 'SESSION_NOT_FOUND');
  console.log('PASS [6]: CLOSE without prior saved OPEN is rejected');

  // 7. Successful CLOSE updates session to COMPLETED after DB commit
  const closeEvent2 = crypto.randomUUID();
  const closeTime2 = '2026-11-10T05:15:00.000Z';

  const closeRes2 = await service.ingestEvent({
    eventId: closeEvent2,
    sessionId: session2,
    stationId: 'station_a',
    triggerSource: 'PHYSICAL_BUTTON',
    eventType: 'CLOSE',
    occurredAt: closeTime2
  });

  assert.strictEqual(closeRes2.success, true);
  assert.strictEqual(closeRes2.status, 'CLOSED_SAVED');
  assert.strictEqual(closeRes2.sessionId, session2);
  assert.strictEqual(closeRes2.session?.status, 'COMPLETED');
  assert.strictEqual(closeRes2.session?.closedAt, closeTime2);
  console.log('PASS [7]: CLOSE updates matching open session to COMPLETED');

  // 8. Extra CLOSE on already closed session is rejected
  const extraCloseRes = await service.ingestEvent({
    eventId: crypto.randomUUID(),
    sessionId: session2,
    stationId: 'station_a',
    triggerSource: 'PHYSICAL_BUTTON',
    eventType: 'CLOSE',
    occurredAt: '2026-11-10T05:16:00.000Z'
  });

  assert.strictEqual(extraCloseRes.success, false);
  assert.strictEqual(extraCloseRes.status, 'SESSION_ALREADY_CLOSED');
  console.log('PASS [8]: Extra CLOSE on already completed session is rejected');

  // 9. Socket.IO Gateway End-to-End: ACK returned only after commit, with matching eventId
  process.env.DEVICE_INGEST_TOKEN = 'test-collection-secret-token-v2';
  const httpServer = createServer();
  const gateway = new RealtimeGateway(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const address = httpServer.address() as { port: number };
  const serverUrl = `http://127.0.0.1:${address.port}`;

  const clientSocket = createClientSocket(serverUrl, {
    auth: {
      type: 'device',
      token: 'test-collection-secret-token-v2',
      deviceId: 'raspberry-pi-5'
    },
    transports: ['websocket']
  });

  try {
    await new Promise<void>((resolve, reject) => {
      clientSocket.on('connect', () => resolve());
      clientSocket.on('connect_error', (err) => reject(err));
    });

    const session3 = crypto.randomUUID();
    const openEvent3 = crypto.randomUUID();
    const closeEvent3 = crypto.randomUUID();

    // 9a. Successful OPEN
    const ackOpen: any = await new Promise((resolve) => {
      clientSocket.emit(
        REALTIME_EVENTS.DEVICE_COLLECTION_EVENT,
        {
          eventId: openEvent3,
          sessionId: session3,
          stationId: 'station_a',
          triggerSource: 'PHYSICAL_BUTTON',
          eventType: 'OPEN',
          occurredAt: '2026-11-10T07:00:00.000Z'
        },
        (resp: any) => resolve(resp)
      );
    });

    assert.strictEqual(ackOpen.success, true);
    assert.strictEqual(ackOpen.status, 'OPENED_SAVED');
    assert.strictEqual(ackOpen.eventId, openEvent3);
    assert.strictEqual(ackOpen.sessionId, session3);

    // 9b. When DB transaction fails, Gateway returns success: false with matching eventId
    setFailTransaction(true);
    const failEvent3 = crypto.randomUUID();
    const ackFail: any = await new Promise((resolve) => {
      clientSocket.emit(
        REALTIME_EVENTS.DEVICE_COLLECTION_EVENT,
        {
          eventId: failEvent3,
          sessionId: session3,
          stationId: 'station_a',
          triggerSource: 'PHYSICAL_BUTTON',
          eventType: 'CLOSE',
          occurredAt: '2026-11-10T07:03:00.000Z'
        },
        (resp: any) => resolve(resp)
      );
    });

    assert.strictEqual(ackFail.success, false, 'Failed transaction must not return success=true');
    assert.strictEqual(ackFail.status, 'INGESTION_ERROR');
    assert.strictEqual(ackFail.eventId, failEvent3);
    setFailTransaction(false);

    // 9c. Successful CLOSE after recovery
    const ackClose: any = await new Promise((resolve) => {
      clientSocket.emit(
        REALTIME_EVENTS.DEVICE_COLLECTION_EVENT,
        {
          eventId: closeEvent3,
          sessionId: session3,
          stationId: 'station_a',
          triggerSource: 'PHYSICAL_BUTTON',
          eventType: 'CLOSE',
          occurredAt: '2026-11-10T07:05:00.000Z'
        },
        (resp: any) => resolve(resp)
      );
    });

    assert.strictEqual(ackClose.success, true);
    assert.strictEqual(ackClose.status, 'CLOSED_SAVED');
    assert.strictEqual(ackClose.eventId, closeEvent3);
    assert.strictEqual(ackClose.sessionId, session3);
    console.log('PASS [9]: Socket.IO Gateway end-to-end OPEN + Transaction Failure + CLOSE verified');
  } finally {
    clientSocket.disconnect();
    await new Promise<void>((resolve) => gateway.io.close(() => resolve()));
    httpServer.close();
  }

  console.log('=== ALL 9 TECHNICAL CORRECTION BACKEND TESTS PASSED ===');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
