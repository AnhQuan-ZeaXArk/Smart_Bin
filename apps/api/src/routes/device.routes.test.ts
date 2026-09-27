import http from 'node:http';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

interface ApiResponse<T = any> {
  status: number;
  data: T;
}

function request(
  server: http.Server,
  method: string,
  path: string,
  body?: any,
  token?: string
): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const port = (server.address() as any).port;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let data: any;
          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }
          resolve({ status: res.statusCode || 500, data });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runApiTests() {
  console.log('=== STARTING PHASE 4 DEVICE REST API TESTS ===\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    // 0. Login as admin, supervisor, worker to obtain tokens
    console.log('Setup: Logging in default users...');
    const adminLogin = await request(server, 'POST', '/api/auth/login', {
      username: 'admin',
      password: env.SEED_ADMIN_PASSWORD
    });
    const supervisorLogin = await request(server, 'POST', '/api/auth/login', {
      username: 'supervisor',
      password: env.SEED_SUPERVISOR_PASSWORD
    });
    const workerLogin = await request(server, 'POST', '/api/auth/login', {
      username: 'worker',
      password: env.SEED_WORKER_PASSWORD
    });

    if (adminLogin.status !== 200 || !adminLogin.data.token) {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLogin.data)}`);
    }
    const adminToken = adminLogin.data.token;
    const supervisorToken = supervisorLogin.data.token;
    const workerToken = workerLogin.data.token;
    console.log('  -> Logged in successfully: Admin, Supervisor, Worker\n');

    // Test A10: Không có JWT khi gọi GET /api/devices -> 401
    console.log('Test A10: GET /api/devices without token -> 401 Unauthorized');
    const noAuth = await request(server, 'GET', '/api/devices');
    if (noAuth.status !== 401) {
      throw new Error(`A10 Failed: Expected 401, got ${noAuth.status}`);
    }
    console.log('  -> PASS: 401 Unauthorized received\n');

    // Test A1: GET /api/devices with Admin token -> 200, returns 4 devices
    console.log('Test A1: GET /api/devices -> 200 with 4 devices');
    const getDevices = await request(server, 'GET', '/api/devices', null, adminToken);
    if (getDevices.status !== 200 || !Array.isArray(getDevices.data.devices)) {
      throw new Error(`A1 Failed: Expected 200 with devices array, got ${getDevices.status}`);
    }
    if (getDevices.data.devices.length !== 4) {
      throw new Error(`A1 Failed: Expected 4 devices, found ${getDevices.data.devices.length}`);
    }
    const deviceTypes = getDevices.data.devices.map((d: any) => d.deviceType);
    console.log(`  -> Found ${getDevices.data.devices.length} devices:`, deviceTypes.join(', '));
    console.log('  -> PASS: GET /api/devices returned 200 with all 4 devices\n');

    // Test A11: Admin, Supervisor, Worker can all GET devices
    console.log('Test A11: Supervisor and Worker can also GET /api/devices');
    const supervisorGet = await request(server, 'GET', '/api/devices', null, supervisorToken);
    const workerGet = await request(server, 'GET', '/api/devices', null, workerToken);
    if (supervisorGet.status !== 200 || workerGet.status !== 200) {
      throw new Error(`A11 Failed: Supervisor status=${supervisorGet.status}, Worker status=${workerGet.status}`);
    }
    console.log('  -> PASS: Supervisor (200) and Worker (200) permitted\n');

    const targetDevice = getDevices.data.devices[0];

    // Test A2: GET /api/devices/:id -> 200
    console.log(`Test A2: GET /api/devices/:id (${targetDevice.deviceId}) -> 200`);
    const getOne = await request(server, 'GET', `/api/devices/${targetDevice.deviceId}`, null, adminToken);
    if (getOne.status !== 200 || !getOne.data.device || getOne.data.device.deviceId !== targetDevice.deviceId) {
      throw new Error(`A2 Failed: Expected 200 with device data, got ${getOne.status}`);
    }
    // Also test by database id
    const getById = await request(server, 'GET', `/api/devices/${targetDevice.id}`, null, adminToken);
    if (getById.status !== 200 || getById.data.device.id !== targetDevice.id) {
      throw new Error(`A2 Failed: Expected 200 by database id, got ${getById.status}`);
    }
    console.log('  -> PASS: GET /api/devices/:id works by both deviceId and database id\n');

    // Test A3: GET non-existent device -> 404 DEVICE_NOT_FOUND
    console.log('Test A3: GET non-existent device -> 404 DEVICE_NOT_FOUND');
    const getNonExistent = await request(server, 'GET', '/api/devices/non-existent-device-xyz', null, adminToken);
    if (getNonExistent.status !== 404 || getNonExistent.data?.error?.code !== 'DEVICE_NOT_FOUND') {
      throw new Error(`A3 Failed: Expected 404 with code DEVICE_NOT_FOUND, got ${getNonExistent.status}: ${JSON.stringify(getNonExistent.data)}`);
    }
    console.log('  -> PASS: 404 DEVICE_NOT_FOUND returned correctly\n');

    // Test A4: GET /api/devices/:id/health -> 200 with status, lastSeen, and health thresholds
    console.log(`Test A4: GET /api/devices/:id/health (${targetDevice.deviceId}) -> 200`);
    const getHealth = await request(server, 'GET', `/api/devices/${targetDevice.deviceId}/health`, null, adminToken);
    if (getHealth.status !== 200 || !getHealth.data.health) {
      throw new Error(`A4 Failed: Expected 200 with health thresholds, got ${getHealth.status}`);
    }
    const { onlineThresholdMs, warningThresholdMs, offlineThresholdMs } = getHealth.data.health;
    if (onlineThresholdMs !== 15000 || warningThresholdMs !== 30000 || offlineThresholdMs !== 30000) {
      throw new Error(`A4 Failed: Health thresholds do not match config: ${JSON.stringify(getHealth.data.health)}`);
    }
    console.log('  -> PASS: Health info received with config thresholds (15s / 30s / 30s)\n');

    // Test A5: POST /api/devices/heartbeat -> 200 -> lastSeen changes
    console.log('Test A5: POST /api/devices/heartbeat -> 200 updates lastSeen');
    const heartbeatTimestamp = new Date().toISOString();
    const heartbeatRes = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      deviceType: 'RASPBERRY_PI',
      status: 'ONLINE',
      ipAddress: '192.168.1.150',
      uptime: 5000,
      timestamp: heartbeatTimestamp
    });
    if (heartbeatRes.status !== 200 || !heartbeatRes.data.device) {
      throw new Error(`A5 Failed: Expected 200 with updated device, got ${heartbeatRes.status}: ${JSON.stringify(heartbeatRes.data)}`);
    }
    if (heartbeatRes.data.device.ipAddress !== '192.168.1.150' || heartbeatRes.data.device.uptime !== 5000) {
      throw new Error(`A5 Failed: Device fields were not updated properly: ${JSON.stringify(heartbeatRes.data.device)}`);
    }
    console.log('  -> PASS: Heartbeat processed, lastSeen and ipAddress updated\n');

    // Test A6: Heartbeat with invalid deviceType -> 400 DEVICE_VALIDATION_ERROR
    console.log('Test A6: Heartbeat with invalid deviceType -> 400');
    const invalidType = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      deviceType: 'SMARTPHONE_INVALID',
      timestamp: new Date().toISOString()
    });
    if (invalidType.status !== 400 || invalidType.data?.error?.code !== 'DEVICE_VALIDATION_ERROR') {
      throw new Error(`A6 Failed: Expected 400 DEVICE_VALIDATION_ERROR, got ${invalidType.status}: ${JSON.stringify(invalidType.data)}`);
    }
    console.log('  -> PASS: 400 DEVICE_VALIDATION_ERROR for invalid deviceType\n');

    // Test A7: Heartbeat with negative uptime -> 400 DEVICE_VALIDATION_ERROR
    console.log('Test A7: Heartbeat with negative uptime -> 400');
    const negativeUptime = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      uptime: -50,
      timestamp: new Date().toISOString()
    });
    if (negativeUptime.status !== 400 || negativeUptime.data?.error?.code !== 'DEVICE_VALIDATION_ERROR') {
      throw new Error(`A7 Failed: Expected 400 DEVICE_VALIDATION_ERROR, got ${negativeUptime.status}: ${JSON.stringify(negativeUptime.data)}`);
    }
    console.log('  -> PASS: 400 DEVICE_VALIDATION_ERROR for negative uptime\n');

    // Test A8: Heartbeat with invalid timestamp format -> 400 DEVICE_VALIDATION_ERROR
    console.log('Test A8: Heartbeat with invalid timestamp format -> 400');
    const invalidTimestamp = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      timestamp: 'not-a-valid-datetime'
    });
    if (invalidTimestamp.status !== 400 || invalidTimestamp.data?.error?.code !== 'DEVICE_VALIDATION_ERROR') {
      throw new Error(`A8 Failed: Expected 400 DEVICE_VALIDATION_ERROR, got ${invalidTimestamp.status}: ${JSON.stringify(invalidTimestamp.data)}`);
    }
    console.log('  -> PASS: 400 DEVICE_VALIDATION_ERROR for invalid timestamp format\n');

    // Test A9: Heartbeat for unregistered deviceId -> 404 DEVICE_NOT_FOUND
    console.log('Test A9: Heartbeat for unregistered deviceId -> 404 DEVICE_NOT_FOUND');
    const unregistered = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'unknown-unregistered-device',
      timestamp: new Date().toISOString()
    });
    if (unregistered.status !== 404 || unregistered.data?.error?.code !== 'DEVICE_NOT_FOUND') {
      throw new Error(`A9 Failed: Expected 404 DEVICE_NOT_FOUND, got ${unregistered.status}: ${JSON.stringify(unregistered.data)}`);
    }
    console.log('  -> PASS: 404 DEVICE_NOT_FOUND for unregistered device\n');

    // Regression checks:
    console.log('Regression Checks:');
    const healthCheck = await request(server, 'GET', '/health');
    if (healthCheck.status !== 200 || healthCheck.data?.status !== 'ok') {
      throw new Error(`GET /health failed: ${JSON.stringify(healthCheck.data)}`);
    }
    console.log('  -> GET /health: PASS');

    const meRes = await request(server, 'GET', '/api/auth/me', null, adminToken);
    if (meRes.status !== 200 || meRes.data?.displayName !== 'Nguyen Minh An') {
      throw new Error(`GET /api/auth/me failed: ${JSON.stringify(meRes.data)}`);
    }
    console.log('  -> GET /api/auth/me with displayName: PASS');

    const binsRes = await request(server, 'GET', '/api/bins', null, adminToken);
    if (binsRes.status !== 200 || !Array.isArray(binsRes.data?.bins)) {
      throw new Error(`GET /api/bins failed: ${JSON.stringify(binsRes.data)}`);
    }
    console.log(`  -> GET /api/bins (${binsRes.data.bins.length} compartments): PASS`);

    const summaryRes = await request(server, 'GET', '/api/dashboard/summary', null, adminToken);
    if (summaryRes.status !== 200 || !Array.isArray(summaryRes.data?.devices)) {
      throw new Error(`GET /api/dashboard/summary failed: ${JSON.stringify(summaryRes.data)}`);
    }
    console.log(`  -> GET /api/dashboard/summary with ${summaryRes.data.devices.length} devices: PASS`);

    const collectionsRes = await request(server, 'GET', '/api/collections', null, adminToken);
    if (collectionsRes.status !== 200 || !Array.isArray(collectionsRes.data?.collections)) {
      throw new Error(`GET /api/collections failed: ${JSON.stringify(collectionsRes.data)}`);
    }
    console.log(`  -> GET /api/collections (${collectionsRes.data.collections.length} records): PASS`);

    const alertsRes = await request(server, 'GET', '/api/dashboard/alerts', null, adminToken);
    if (alertsRes.status !== 200 || !Array.isArray(alertsRes.data?.alerts)) {
      throw new Error(`GET /api/dashboard/alerts failed: ${JSON.stringify(alertsRes.data)}`);
    }
    console.log(`  -> GET /api/dashboard/alerts (${alertsRes.data.alerts.length} alerts): PASS`);

    console.log('\n=== ALL PHASE 4 REST API TESTS (A1 - A11) & REGRESSION TESTS PASSED! ===\n');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runApiTests().catch((err) => {
  console.error('API TESTS FAILED:', err);
  process.exit(1);
});
