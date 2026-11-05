import { createServer } from 'node:http';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { RealtimeGateway } from './realtime.gateway.js';
import { REALTIME_EVENTS } from './realtime.contract.js';
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
        return;
      }
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(data);
    }

    socket.on(event, listener);
  });
}

async function runHardwareTelemetryTests() {
  console.log('=== RUNNING TASK 1F HARDWARE TELEMETRY & MULTI-COMPARTMENT INTEGRATION TESTS ===\n');

  const testToken = 'test-pi5-token-hardware-1f';
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

  let piSocket: ClientSocketType | null = null;
  let webSocket: ClientSocketType | null = null;

  try {
    // 1. Kết nối Pi Socket với token hợp lệ
    console.log('Test H1: Pi 5 socket connects with valid device token');
    piSocket = await new Promise<ClientSocketType>((resolve, reject) => {
      const s = ClientSocket(socketUrl, {
        auth: { type: 'device', token: testToken, deviceId: 'raspberry-pi-5' },
        transports: ['websocket'],
        reconnection: false
      });
      s.on('connect', () => {
        console.log('  -> PASS: Raspberry Pi 5 socket connected');
        resolve(s);
      });
      s.on('connect_error', (err) => reject(err));
    });

    // 2. Kết nối Web Client (chế độ public-viewer)
    console.log('Test H2: Web client connects as public-viewer without token');
    webSocket = await new Promise<ClientSocketType>((resolve, reject) => {
      const s = ClientSocket(socketUrl, {
        transports: ['websocket'],
        reconnection: false
      });
      s.on('connect', () => {
        console.log('  -> PASS: Public Web viewer connected successfully\n');
        resolve(s);
      });
      s.on('connect_error', (err) => reject(err));
    });

    // 3. Gửi Telemetry mở rộng với Subsystems, AI Detection và 3 ngăn rác
    console.log('Test H3: Pi sends extended telemetry with Subsystems, AI Detection & 3-Compartments');
    const extendedPayload = {
      deviceId: 'raspberry-pi-5',
      deviceName: 'Raspberry Pi 5 Gateway',
      status: 'ONLINE',
      uptimeSeconds: 8400,
      cpuTempC: 48.2,
      firmwareVersion: '2.0.0',
      ipAddress: '192.168.1.105',
      sentAt: new Date().toISOString(),
      subsystems: {
        yolo: 'RUNNING',
        camera: 'CONNECTED',
        esp32: 'CONNECTED'
      },
      aiDetection: {
        class: 'RECYCLABLE',
        rawClass: 'plastic_bottle',
        confidence: 0.958,
        inferenceTimeMs: 34.2,
        timestamp: new Date().toISOString()
      },
      sensors: {
        distanceCm: 18.2,
        fillLevel: 71,
        organic: {
          distanceCm: 35.0,
          fillLevel: 33,
          status: 'OK',
          updatedAt: new Date().toISOString()
        },
        recyclable: {
          distanceCm: 18.2,
          fillLevel: 71,
          status: 'OK',
          updatedAt: new Date().toISOString()
        },
        nonRecyclable: {
          distanceCm: 8.5,
          fillLevel: 92,
          status: 'OK',
          updatedAt: new Date().toISOString()
        }
      }
    };

    const heartbeatPromise = waitForEvent<RealDeviceStatus>(
      webSocket,
      REALTIME_EVENTS.DEVICE_HEARTBEAT,
      (data) => data.deviceId === 'raspberry-pi-5'
    );

    piSocket.emit(REALTIME_EVENTS.DEVICE_TELEMETRY, extendedPayload);

    const receivedHeartbeat = await heartbeatPromise;

    if (
      receivedHeartbeat.subsystems?.yolo === 'RUNNING' &&
      receivedHeartbeat.subsystems?.camera === 'CONNECTED' &&
      receivedHeartbeat.subsystems?.esp32 === 'CONNECTED'
    ) {
      console.log('  -> PASS: Subsystems status verified (YOLO: RUNNING, Cam: CONNECTED, ESP32: CONNECTED)');
    } else {
      throw new Error(`Subsystems mismatch: ${JSON.stringify(receivedHeartbeat.subsystems)}`);
    }

    if (
      receivedHeartbeat.aiDetection?.class === 'RECYCLABLE' &&
      receivedHeartbeat.aiDetection?.confidence === 0.958 &&
      receivedHeartbeat.aiDetection?.inferenceTimeMs === 34.2
    ) {
      console.log('  -> PASS: AI Detection payload verified (RECYCLABLE, confidence 0.958, 34.2ms)');
    } else {
      throw new Error(`AI Detection mismatch: ${JSON.stringify(receivedHeartbeat.aiDetection)}`);
    }

    if (
      receivedHeartbeat.sensors?.organic?.fillLevel === 33 &&
      receivedHeartbeat.sensors?.recyclable?.fillLevel === 71 &&
      receivedHeartbeat.sensors?.nonRecyclable?.fillLevel === 92
    ) {
      console.log('  -> PASS: 3-Compartment Fill levels verified (Organic: 33%, Recyclable: 71%, NonRecyclable: 92%)\n');
    } else {
      throw new Error(`3-Compartment fill levels mismatch: ${JSON.stringify(receivedHeartbeat.sensors)}`);
    }

    // 4. Kiểm tra REST Endpoint GET /api/demo/device-status
    console.log('Test H4: Public REST endpoint GET /api/demo/device-status returns complete hardware state');
    const restRes = await fetch(`http://localhost:${port}/api/demo/device-status`);
    if (!restRes.ok) throw new Error(`HTTP ${restRes.status}`);
    const restJson = (await restRes.json()) as any;

    if (
      restJson.success &&
      restJson.data.subsystems?.yolo === 'RUNNING' &&
      restJson.data.aiDetection?.class === 'RECYCLABLE' &&
      restJson.data.sensors?.recyclable?.distanceCm === 18.2
    ) {
      console.log('  -> PASS: REST status matches realtime state perfectly\n');
    } else {
      throw new Error(`REST data mismatch: ${JSON.stringify(restJson)}`);
    }

    // 5. Kiểm tra AI Detection Ring Buffer (Lưu trữ 10 lần nhận diện gần nhất)
    console.log('Test H5: AI Detection History buffer preserves recent detections');
    const secondPayload = {
      ...extendedPayload,
      aiDetection: {
        class: 'ORGANIC',
        rawClass: 'banana_peel',
        confidence: 0.912,
        inferenceTimeMs: 29.5,
        timestamp: new Date().toISOString()
      }
    };
    piSocket.emit(REALTIME_EVENTS.DEVICE_TELEMETRY, secondPayload);
    await new Promise((r) => setTimeout(r, 200));

    const statusAfterSecond = realDeviceService.getStatus();
    if (
      statusAfterSecond.detectionHistory.length === 2 &&
      statusAfterSecond.detectionHistory[0].class === 'ORGANIC' &&
      statusAfterSecond.detectionHistory[1].class === 'RECYCLABLE'
    ) {
      console.log('  -> PASS: Detection history buffer verified (ORGANIC followed by RECYCLABLE)\n');
    } else {
      throw new Error(`Detection history mismatch: ${JSON.stringify(statusAfterSecond.detectionHistory)}`);
    }

    // 6. Kiểm tra HTTP Heartbeat Fallback Endpoint
    console.log('Test H6: Fallback HTTP POST /api/demo/device-heartbeat accepts extended payload');
    const fallbackRes = await fetch(`http://localhost:${port}/api/demo/device-heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`
      },
      body: JSON.stringify({
        deviceId: 'raspberry-pi-5',
        uptimeSeconds: 8500,
        cpuTempC: 49.0,
        sentAt: new Date().toISOString(),
        subsystems: {
          yolo: 'RUNNING',
          camera: 'CONNECTED',
          esp32: 'CONNECTED'
        },
        aiDetection: {
          class: 'NON_RECYCLABLE',
          confidence: 0.880,
          inferenceTimeMs: 31.0,
          timestamp: new Date().toISOString()
        },
        sensors: {
          distanceCm: 10.0,
          fillLevel: 89,
          nonRecyclable: {
            distanceCm: 10.0,
            fillLevel: 89,
            status: 'OK'
          }
        }
      })
    });

    if (fallbackRes.status === 200) {
      const fbJson = (await fallbackRes.json()) as any;
      if (fbJson.data?.aiDetection?.class === 'NON_RECYCLABLE') {
        console.log('  -> PASS: Fallback HTTP heartbeat accepted and processed successfully\n');
      } else {
        throw new Error(`Fallback response unexpected: ${JSON.stringify(fbJson)}`);
      }
    } else {
      throw new Error(`Fallback HTTP returned status ${fallbackRes.status}`);
    }

    // 7. Confidence ngoài [0, 1] qua Socket.IO: heartbeat vẫn được ghi nhận, aiDetection không hợp lệ bị loại bỏ
    console.log('Test H7: Socket telemetry with out-of-range confidence (95.8) keeps heartbeat but drops aiDetection');
    const historyBeforeInvalid = realDeviceService.getStatus().detectionHistory.length;
    const invalidSocketHeartbeat = waitForEvent<RealDeviceStatus>(
      webSocket,
      REALTIME_EVENTS.DEVICE_HEARTBEAT,
      (data) => data.deviceId === 'raspberry-pi-5' && data.uptimeSeconds === 8600
    );
    piSocket.emit(REALTIME_EVENTS.DEVICE_TELEMETRY, {
      ...extendedPayload,
      uptimeSeconds: 8600,
      aiDetection: {
        class: 'RECYCLABLE',
        rawClass: 'plastic_bottle',
        confidence: 95.8,
        inferenceTimeMs: 30.0,
        timestamp: new Date().toISOString()
      }
    });
    const invalidHb = await invalidSocketHeartbeat;
    const statusAfterInvalid = realDeviceService.getStatus();
    if (
      invalidHb.uptimeSeconds === 8600 &&
      statusAfterInvalid.detectionHistory.length === historyBeforeInvalid &&
      statusAfterInvalid.aiDetection?.confidence === 0.880 &&
      statusAfterInvalid.aiDetection?.class === 'NON_RECYCLABLE'
    ) {
      console.log('  -> PASS: Heartbeat accepted; invalid aiDetection dropped; previous valid detection preserved\n');
    } else {
      throw new Error(`H7 mismatch: ${JSON.stringify({ uptime: invalidHb.uptimeSeconds, ai: statusAfterInvalid.aiDetection, history: statusAfterInvalid.detectionHistory.length })}`);
    }

    // 8. Confidence âm qua HTTP fallback: trả 200, aiDetection không hợp lệ bị loại bỏ (không tự quy đổi)
    console.log('Test H8: HTTP fallback with negative confidence (-0.1) returns 200 and does not record detection');
    const invalidFallbackRes = await fetch(`http://localhost:${port}/api/demo/device-heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`
      },
      body: JSON.stringify({
        deviceId: 'raspberry-pi-5',
        uptimeSeconds: 8700,
        sentAt: new Date().toISOString(),
        aiDetection: {
          class: 'ORGANIC',
          confidence: -0.1,
          timestamp: new Date().toISOString()
        }
      })
    });
    const statusAfterInvalidHttp = realDeviceService.getStatus();
    if (
      invalidFallbackRes.status === 200 &&
      statusAfterInvalidHttp.uptimeSeconds === 8700 &&
      statusAfterInvalidHttp.detectionHistory.length === historyBeforeInvalid &&
      statusAfterInvalidHttp.aiDetection?.class === 'NON_RECYCLABLE'
    ) {
      console.log('  -> PASS: Heartbeat accepted; invalid aiDetection not recorded\n');
    } else {
      throw new Error(`H8 mismatch: status=${invalidFallbackRes.status} ${JSON.stringify({ uptime: statusAfterInvalidHttp.uptimeSeconds, ai: statusAfterInvalidHttp.aiDetection, history: statusAfterInvalidHttp.detectionHistory.length })}`);
    }

    // 9. confidence = null (trước đây bị coerce thành 0 và lọt qua) phải bị loại bỏ, heartbeat vẫn được nhận
    console.log('Test H9: HTTP fallback with confidence null is not coerced to 0 and is not recorded');
    const nullConfRes = await fetch(`http://localhost:${port}/api/demo/device-heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`
      },
      body: JSON.stringify({
        deviceId: 'raspberry-pi-5',
        uptimeSeconds: 8800,
        sentAt: new Date().toISOString(),
        aiDetection: {
          class: 'ORGANIC',
          confidence: null,
          timestamp: new Date().toISOString()
        }
      })
    });
    const statusAfterNullConf = realDeviceService.getStatus();
    if (
      nullConfRes.status === 200 &&
      statusAfterNullConf.uptimeSeconds === 8800 &&
      statusAfterNullConf.detectionHistory.length === historyBeforeInvalid &&
      statusAfterNullConf.aiDetection?.class === 'NON_RECYCLABLE' &&
      statusAfterNullConf.aiDetection?.confidence === 0.880
    ) {
      console.log('  -> PASS: Heartbeat accepted; null confidence rejected (not coerced to 0)\n');
    } else {
      throw new Error(`H9 mismatch: status=${nullConfRes.status} ${JSON.stringify({ uptime: statusAfterNullConf.uptimeSeconds, ai: statusAfterNullConf.aiDetection, history: statusAfterNullConf.detectionHistory.length })}`);
    }

    console.log('=== ALL TASK 1F HARDWARE INTEGRATION TESTS PASSED CLEANLY (9/9) ===');
  } finally {
    if (piSocket) piSocket.close();
    if (webSocket) webSocket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    realDeviceService.reset();
  }
}

runHardwareTelemetryTests().catch((err) => {
  console.error('\nFATAL TEST FAILURE:', err);
  process.exit(1);
});

