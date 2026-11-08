import assert from 'node:assert';
import { createServer } from 'node:http';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { app } from '../../app.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { REALTIME_EVENTS } from './realtime.contract.js';
import { prisma } from '../../lib/prisma.js';

function waitForEvent<T = unknown>(
  socket: ClientSocketType,
  event: string,
  timeoutMs = 4000
): Promise<T> {
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

async function runSocketIOMultiStationTests() {
  console.log('=== RUNNING SOCKET.IO MULTI-STATION PROTOCOL & ACK TESTS ===\n');

  // Setup Mock Prisma for in-memory safety
  const stations: any[] = [
    { id: 'st-a', code: 'STATION_A', name: 'Trạm A', isActive: true },
    { id: 'st-b', code: 'STATION_B', name: 'Trạm B', isActive: true },
    { id: 'st-disabled', code: 'STATION_LOCKED', name: 'Trạm Khóa', isActive: false }
  ];

  (prisma as any).station = {
    findUnique: async ({ where }: any) => stations.find((s) => s.code === where.code) || null
  };

  const testDeviceToken = 'test-device-token-blocker-fix';
  process.env.DEVICE_INGEST_TOKEN = testDeviceToken;

  const httpServer = createServer(app);
  const realtime = new RealtimeGateway(httpServer);
  app.set('realtime', realtime);
  app.set('io', realtime.io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as any).port;
  const socketUrl = `http://localhost:${port}`;

  let clientSocket: ClientSocketType | null = null;
  let deviceSocket: ClientSocketType | null = null;

  try {
    // ----------------------------------------------------
    // TEST 1: Client kết nối và đăng ký 'subscribe:station'
    // ----------------------------------------------------
    console.log("Test 1: Web client đăng ký trạm với 'subscribe:station'");
    clientSocket = ClientSocket(socketUrl, {
      auth: { token: undefined }, // public viewer
      transports: ['websocket'],
      reconnection: false
    });

    await waitForEvent(clientSocket, REALTIME_EVENTS.CONNECTED);

    const subAck = await new Promise<any>((resolve) => {
      clientSocket!.emit('subscribe:station', { stationCode: 'STATION_A' }, (res: any) => {
        resolve(res);
      });
    });

    assert.strictEqual(subAck.success, true);
    assert.strictEqual(subAck.stationCode, 'STATION_A');
    console.log("  -> PASS: 'subscribe:station' cho STATION_A thành công\n");

    // ----------------------------------------------------
    // TEST 2: Chuyển trạm từ A sang B (Rời A, gia nhập B)
    // ----------------------------------------------------
    console.log("Test 2: Chuyển trạm từ STATION_A sang STATION_B");
    const switchAck = await new Promise<any>((resolve) => {
      clientSocket!.emit('subscribe:station', { stationCode: 'STATION_B' }, (res: any) => {
        resolve(res);
      });
    });

    assert.strictEqual(switchAck.success, true);
    assert.strictEqual(switchAck.stationCode, 'STATION_B');

    // Kiểm tra phía server: socket client chỉ còn trong phòng STATION_B
    const serverClientSocket = Array.from(realtime.io.sockets.sockets.values()).find(
      (s) => s.id === clientSocket!.id
    );
    assert.ok(serverClientSocket, 'Tìm thấy socket trên server');
    assert.strictEqual(serverClientSocket.rooms.has('station:STATION_B:telemetry'), true, 'Đã gia nhập room B');
    assert.strictEqual(serverClientSocket.rooms.has('station:STATION_A:telemetry'), false, 'Đã rời room A');
    console.log("  -> PASS: Chuyển trạm an toàn: đã rời room STATION_A và gia nhập room STATION_B\n");

    // ----------------------------------------------------
    // TEST 3: Từ chối truy cập trạm bị vô hiệu hóa
    // ----------------------------------------------------
    console.log("Test 3: Từ chối truy cập trạm không tồn tại hoặc bị vô hiệu hóa");
    const errorPromise = waitForEvent<any>(clientSocket, 'error:station_access');
    const rejectAck = await new Promise<any>((resolve) => {
      clientSocket!.emit('subscribe:station', { stationCode: 'STATION_LOCKED' }, (res: any) => {
        resolve(res);
      });
    });

    assert.strictEqual(rejectAck.success, false);
    assert.strictEqual(rejectAck.error, 'STATION_NOT_FOUND_OR_INACTIVE');
    const errEvent = await errorPromise;
    assert.strictEqual(errEvent.stationCode, 'STATION_LOCKED');
    assert.strictEqual(serverClientSocket.rooms.has('station:STATION_LOCKED:telemetry'), false, 'Không được phép vào room');
    console.log("  -> PASS: Trạm vô hiệu hóa bị từ chối truy cập nghiêm ngặt\n");

    // ----------------------------------------------------
    // TEST 4: 'unsubscribe:station' thành công
    // ----------------------------------------------------
    console.log("Test 4: 'unsubscribe:station' rời phòng trạm");
    const unsubAck = await new Promise<any>((resolve) => {
      clientSocket!.emit('unsubscribe:station', { stationCode: 'STATION_B' }, (res: any) => {
        resolve(res);
      });
    });

    assert.strictEqual(unsubAck.success, true);
    assert.strictEqual(serverClientSocket.rooms.has('station:STATION_B:telemetry'), false, 'Đã rời room B hoàn tất');
    console.log("  -> PASS: 'unsubscribe:station' hoạt động chính xác\n");

    // ----------------------------------------------------
    // TEST 5: Device Telemetry ACK Callback (BLOCKER-01 Server Verification)
    // ----------------------------------------------------
    console.log("Test 5: Device Telemetry trả về ACK Callback xác nhận commit thành công");
    deviceSocket = ClientSocket(socketUrl, {
      auth: { type: 'device', token: testDeviceToken, deviceId: 'raspberry-pi-5' },
      transports: ['websocket'],
      reconnection: false
    });

    await waitForEvent(deviceSocket, REALTIME_EVENTS.CONNECTED);

    const testPayload = {
      deviceId: 'raspberry-pi-5',
      stationCode: 'STATION_A',
      uptimeSeconds: 1200,
      cpuTempC: 45.5,
      clientMessageId: 'msg-test-ack-callback-01',
      subsystems: { yolo: 'RUNNING', camera: 'CONNECTED' }
    };

    const deviceAck = await new Promise<any>((resolve) => {
      deviceSocket!.emit('device:telemetry', testPayload, (ackRes: any) => {
        resolve(ackRes);
      });
    });

    assert.strictEqual(deviceAck.success, true, 'Backend xác nhận thành công');
    assert.strictEqual(deviceAck.clientMessageId, 'msg-test-ack-callback-01');
    assert.ok(deviceAck.timestamp, 'Có timestamp xác nhận');
    console.log("  -> PASS: Device telemetry ACK callback phản hồi thành công:", deviceAck);

    // ----------------------------------------------------
    // TEST 6: Device Telemetry Validation Failure -> ACK thất bại
    // ----------------------------------------------------
    console.log("\nTest 6: Gói telemetry không hợp lệ -> ACK trả về success: false");
    const badPayload = {
      deviceId: '', // Invalid empty deviceId
      uptimeSeconds: -10 // Invalid negative uptime
    };

    const badAck = await new Promise<any>((resolve) => {
      deviceSocket!.emit('device:telemetry', badPayload, (ackRes: any) => {
        resolve(ackRes);
      });
    });

    assert.strictEqual(badAck.success, false);
    assert.strictEqual(badAck.status, 'VALIDATION_FAILED');
    console.log("  -> PASS: Gói tin không hợp lệ bị từ chối với status VALIDATION_FAILED\n");

    console.log('===========================================================');
    console.log('ALL SOCKET.IO MULTI-STATION & ACK TESTS PASSED (6/6)!');
    console.log('===========================================================');
  } finally {
    if (clientSocket) clientSocket.disconnect();
    if (deviceSocket) deviceSocket.disconnect();
    httpServer.close();
  }
}

runSocketIOMultiStationTests().catch((err) => {
  console.error('SOCKET.IO TESTS FAILED:', err);
  process.exit(1);
});

