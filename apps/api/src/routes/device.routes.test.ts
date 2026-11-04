import http from 'node:http';
import bcrypt from 'bcrypt';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { DeviceType, DeviceStatusEnum, RoleName } from '@prisma/client';

const TEST_DEVICE_INGEST_TOKEN = 'test-device-ingest-token-device-routes-test';
process.env.DEVICE_INGEST_TOKEN = TEST_DEVICE_INGEST_TOKEN;

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
  console.log('=== STARTING PHASE 2.2 DEVICE REST API TESTS ===\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    // 0. Setup: Khởi tạo in-memory mock cho Prisma để kiểm thử REST API độc lập,
    // TUYỆT ĐỐI KHÔNG gửi câu lệnh DML lên cơ sở dữ liệu Render PostgreSQL Production
    env.isDemoMode = false;

    const mockRoles = new Map<string, any>();
    const mockUsers = new Map<string, any>();
    const mockDevices = new Map<string, any>();

    (prisma as any).role = {
      upsert: async ({ where, create }: any) => {
        const existing = mockRoles.get(where.name);
        if (existing) return existing;
        const record = { id: `role-${where.name.toLowerCase()}`, name: where.name, description: create?.description };
        mockRoles.set(where.name, record);
        return record;
      }
    };

    (prisma as any).user = {
      upsert: async ({ where, create, update }: any) => {
        const existing = mockUsers.get(where.username);
        const role = Array.from(mockRoles.values()).find((r) => r.id === (create?.roleId || update?.roleId || existing?.roleId));
        const record = {
          id: existing?.id || `user-${where.username}`,
          username: where.username,
          displayName: update?.displayName ?? create?.displayName,
          passwordHash: update?.passwordHash ?? create?.passwordHash,
          roleId: update?.roleId ?? create?.roleId,
          isActive: true,
          role
        };
        mockUsers.set(where.username, record);
        return record;
      },
      findUnique: async ({ where }: any) => {
        if (where.username) {
          return mockUsers.get(where.username) || null;
        }
        if (where.id) {
          return Array.from(mockUsers.values()).find((u) => u.id === where.id) || null;
        }
        return null;
      }
    };

    (prisma as any).deviceStatus = {
      upsert: async ({ where, create, update }: any) => {
        const existing = mockDevices.get(where.deviceId);
        const record = {
          id: existing?.id || `dev-${where.deviceId}`,
          deviceId: where.deviceId,
          deviceName: create?.deviceName || existing?.deviceName || where.deviceId,
          deviceType: create?.deviceType || existing?.deviceType,
          status: update?.status || create?.status || 'ONLINE',
          lastSeen: new Date(),
          lastHeartbeat: new Date(),
          ipAddress: create?.ipAddress || existing?.ipAddress || null,
          uptime: create?.uptime || existing?.uptime || null,
          firmwareVersion: create?.firmwareVersion || existing?.firmwareVersion || null,
          metadata: create?.metadata || existing?.metadata || null,
          createdAt: existing?.createdAt || new Date(),
          updatedAt: new Date()
        };
        mockDevices.set(where.deviceId, record);
        return record;
      },
      findMany: async () => {
        return Array.from(mockDevices.values());
      },
      findUnique: async ({ where }: any) => {
        if (where.deviceId) return mockDevices.get(where.deviceId) || null;
        if (where.id) return Array.from(mockDevices.values()).find((d) => d.id === where.id) || null;
        return null;
      },
      findFirst: async ({ where }: any) => {
        if (where.OR) {
          for (const cond of where.OR) {
            if (cond.id) {
              const match = Array.from(mockDevices.values()).find((d) => d.id === cond.id);
              if (match) return match;
            }
            if (cond.deviceId) {
              const match = mockDevices.get(cond.deviceId);
              if (match) return match;
            }
          }
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        const target = Array.from(mockDevices.values()).find((d) => d.id === where.id) || mockDevices.get(where.deviceId);
        if (!target) throw new Error('Device not found');
        Object.assign(target, data, { updatedAt: new Date() });
        return target;
      }
    };

    (prisma as any).alert = {
      findMany: async () => []
    };
    (prisma as any).bin = {
      findMany: async () => [{ id: 'bin-1', binCode: 'ORGANIC' }]
    };
    (prisma as any).collectionRecord = {
      findMany: async () => []
    };

    // 0. Setup: Ensure test roles, default users, and devices exist
    console.log('Setup: Ensuring test roles and default users in database...');
    const roles = await Promise.all([
      prisma.role.upsert({ where: { name: 'ADMIN' }, create: { name: 'ADMIN', description: 'Admin' }, update: {} }),
      prisma.role.upsert({ where: { name: 'SUPERVISOR' }, create: { name: 'SUPERVISOR', description: 'Supervisor' }, update: {} }),
      prisma.role.upsert({ where: { name: 'WORKER' }, create: { name: 'WORKER', description: 'Worker' }, update: {} })
    ]);
    const roleMap = new Map(roles.map((r) => [r.name, r.id]));

    const usersToEnsure: Array<{ username: string; displayName: string; role: RoleName; password: string }> = [
      { username: 'admin', displayName: 'Nguyen Minh An', role: RoleName.ADMIN, password: env.SEED_ADMIN_PASSWORD },
      { username: 'supervisor', displayName: 'Tran Thu Ha', role: RoleName.SUPERVISOR, password: env.SEED_SUPERVISOR_PASSWORD },
      { username: 'worker', displayName: 'Le Van Binh', role: RoleName.WORKER, password: env.SEED_WORKER_PASSWORD }
    ];

    for (const u of usersToEnsure) {
      const passwordHash = await bcrypt.hash(u.password, 10);
      await prisma.user.upsert({
        where: { username: u.username },
        create: {
          username: u.username,
          displayName: u.displayName,
          passwordHash,
          roleId: roleMap.get(u.role)!,
          isActive: true
        },
        update: {
          displayName: u.displayName,
          passwordHash,
          roleId: roleMap.get(u.role)!,
          isActive: true
        }
      });
    }

    const initialDevices = [
      { deviceId: 'raspberry-pi-01', deviceName: 'Raspberry Pi 5 Gateway', deviceType: DeviceType.RASPBERRY_PI, status: DeviceStatusEnum.ONLINE },
      { deviceId: 'mqtt-broker-01', deviceName: 'MQTT Broker', deviceType: DeviceType.MQTT, status: DeviceStatusEnum.ONLINE },
      { deviceId: 'ultrasonic-01', deviceName: 'Cảm biến siêu âm', deviceType: DeviceType.ULTRASONIC_SENSOR, status: DeviceStatusEnum.ONLINE },
      { deviceId: 'camera-01', deviceName: 'Camera AI', deviceType: DeviceType.CAMERA, status: DeviceStatusEnum.ONLINE }
    ];
    for (const d of initialDevices) {
      await prisma.deviceStatus.upsert({
        where: { deviceId: d.deviceId },
        create: d,
        update: { status: d.status }
      });
    }

    // Login as admin, supervisor, worker to obtain tokens
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

    // Test Sec-HB1: POST /api/devices/heartbeat without token -> 401
    console.log('Test Sec-HB1: POST /api/devices/heartbeat without token -> 401 Unauthorized');
    const noTokenHb = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      uptime: 5000,
      timestamp: new Date().toISOString()
    });
    if (noTokenHb.status !== 401) {
      throw new Error(`Sec-HB1 Failed: Expected 401 without token, got ${noTokenHb.status}: ${JSON.stringify(noTokenHb.data)}`);
    }
    console.log('  -> PASS: 401 Unauthorized without token\n');

    // Test Sec-HB2: POST /api/devices/heartbeat with wrong token -> 401
    console.log('Test Sec-HB2: POST /api/devices/heartbeat with invalid token -> 401 Unauthorized');
    const wrongTokenHb = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      uptime: 5000,
      timestamp: new Date().toISOString()
    }, 'wrong-device-token');
    if (wrongTokenHb.status !== 401) {
      throw new Error(`Sec-HB2 Failed: Expected 401 with wrong token, got ${wrongTokenHb.status}: ${JSON.stringify(wrongTokenHb.data)}`);
    }
    console.log('  -> PASS: 401 Unauthorized with invalid token\n');

    // Test Sec-Demo1: Demo Mode + không token -> 401
    console.log('Test Sec-Demo1: Demo Mode + không token -> 401 Unauthorized');
    env.isDemoMode = true;
    const demoNoTokenHb = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      uptime: 5000,
      timestamp: new Date().toISOString()
    });
    if (demoNoTokenHb.status !== 401) {
      env.isDemoMode = false;
      throw new Error(`Sec-Demo1 Failed: Expected 401 without token in demo mode, got ${demoNoTokenHb.status}`);
    }
    console.log('  -> PASS: 401 Unauthorized in Demo Mode without token\n');

    // Test Sec-Demo2: Demo Mode + token sai -> 401
    console.log('Test Sec-Demo2: Demo Mode + token sai -> 401 Unauthorized');
    const demoWrongTokenHb = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      uptime: 5000,
      timestamp: new Date().toISOString()
    }, 'invalid-demo-token');
    if (demoWrongTokenHb.status !== 401) {
      env.isDemoMode = false;
      throw new Error(`Sec-Demo2 Failed: Expected 401 with wrong token in demo mode, got ${demoWrongTokenHb.status}`);
    }
    console.log('  -> PASS: 401 Unauthorized in Demo Mode with wrong token\n');

    // Test Sec-Demo3: Demo Mode + token đúng -> 403 DEMO_MODE_READ_ONLY
    console.log('Test Sec-Demo3: Demo Mode + token đúng -> 403 DEMO_MODE_READ_ONLY');
    const demoValidTokenHb = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      uptime: 5000,
      timestamp: new Date().toISOString()
    }, TEST_DEVICE_INGEST_TOKEN);
    env.isDemoMode = false; // Restore
    if (demoValidTokenHb.status !== 403 || demoValidTokenHb.data?.error?.code !== 'DEMO_MODE_READ_ONLY') {
      throw new Error(`Sec-Demo3 Failed: Expected 403 DEMO_MODE_READ_ONLY, got ${demoValidTokenHb.status}: ${JSON.stringify(demoValidTokenHb.data)}`);
    }
    console.log('  -> PASS: 403 DEMO_MODE_READ_ONLY in Demo Mode with valid token\n');

    // Test A5: POST /api/devices/heartbeat with valid token -> 200 -> lastSeen changes
    console.log('Test A5: POST /api/devices/heartbeat with valid DEVICE_INGEST_TOKEN -> 200 updates lastSeen');
    const heartbeatTimestamp = new Date().toISOString();
    const heartbeatRes = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      deviceType: 'RASPBERRY_PI',
      status: 'ONLINE',
      ipAddress: '192.168.1.150',
      uptime: 5000,
      timestamp: heartbeatTimestamp
    }, TEST_DEVICE_INGEST_TOKEN);
    if (heartbeatRes.status !== 200 || !heartbeatRes.data.device) {
      throw new Error(`A5 Failed: Expected 200 with updated device, got ${heartbeatRes.status}: ${JSON.stringify(heartbeatRes.data)}`);
    }
    if (heartbeatRes.data.device.ipAddress !== '192.168.1.150' || heartbeatRes.data.device.uptime !== 5000) {
      throw new Error(`A5 Failed: Device fields were not updated properly: ${JSON.stringify(heartbeatRes.data.device)}`);
    }
    console.log('  -> PASS: Heartbeat processed with valid token, lastSeen and ipAddress updated\n');

    // Test A6: Heartbeat with invalid deviceType -> 400 DEVICE_VALIDATION_ERROR
    console.log('Test A6: Heartbeat with invalid deviceType -> 400');
    const invalidType = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      deviceType: 'SMARTPHONE_INVALID',
      timestamp: new Date().toISOString()
    }, TEST_DEVICE_INGEST_TOKEN);
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
    }, TEST_DEVICE_INGEST_TOKEN);
    if (negativeUptime.status !== 400 || negativeUptime.data?.error?.code !== 'DEVICE_VALIDATION_ERROR') {
      throw new Error(`A7 Failed: Expected 400 DEVICE_VALIDATION_ERROR, got ${negativeUptime.status}: ${JSON.stringify(negativeUptime.data)}`);
    }
    console.log('  -> PASS: 400 DEVICE_VALIDATION_ERROR for negative uptime\n');

    // Test A8: Heartbeat with invalid timestamp format -> 400 DEVICE_VALIDATION_ERROR
    console.log('Test A8: Heartbeat with invalid timestamp format -> 400');
    const invalidTimestamp = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      timestamp: 'not-a-valid-datetime'
    }, TEST_DEVICE_INGEST_TOKEN);
    if (invalidTimestamp.status !== 400 || invalidTimestamp.data?.error?.code !== 'DEVICE_VALIDATION_ERROR') {
      throw new Error(`A8 Failed: Expected 400 DEVICE_VALIDATION_ERROR, got ${invalidTimestamp.status}: ${JSON.stringify(invalidTimestamp.data)}`);
    }
    console.log('  -> PASS: 400 DEVICE_VALIDATION_ERROR for invalid timestamp format\n');

    // Test A9: Heartbeat for unregistered deviceId -> 404 DEVICE_NOT_FOUND
    console.log('Test A9: Heartbeat for unregistered deviceId -> 404 DEVICE_NOT_FOUND');
    const unregistered = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'unknown-unregistered-device',
      timestamp: new Date().toISOString()
    }, TEST_DEVICE_INGEST_TOKEN);
    if (unregistered.status !== 404 || unregistered.data?.error?.code !== 'DEVICE_NOT_FOUND') {
      throw new Error(`A9 Failed: Expected 404 DEVICE_NOT_FOUND, got ${unregistered.status}: ${JSON.stringify(unregistered.data)}`);
    }
    console.log('  -> PASS: 404 DEVICE_NOT_FOUND for unregistered device\n');

    // --- Device Command Tests (Phase 2.2) ---
    console.log('=== DEVICE COMMAND TESTS (POST /api/devices/command & ALIAS) ===\n');

    // Test Cmd-1: Command without auth -> 401
    console.log('Test Cmd-1: POST /api/devices/command without token -> 401');
    const noAuthCmd = await request(server, 'POST', '/api/devices/command', {
      action: 'PING'
    });
    if (noAuthCmd.status !== 401) {
      throw new Error(`Cmd-1 Failed: Expected 401, got ${noAuthCmd.status}`);
    }
    console.log('  -> PASS: 401 Unauthorized without user JWT\n');

    // Test Cmd-2: Command with WORKER role -> 403 Forbidden
    console.log('Test Cmd-2: POST /api/devices/command with WORKER role -> 403');
    const workerCmd = await request(server, 'POST', '/api/devices/command', {
      action: 'PING'
    }, workerToken);
    if (workerCmd.status !== 403) {
      throw new Error(`Cmd-2 Failed: Expected 403, got ${workerCmd.status}`);
    }
    console.log('  -> PASS: 403 Forbidden for WORKER role\n');

    // Test Cmd-3: Command with invalid action -> 400
    console.log('Test Cmd-3: POST /api/devices/command with invalid action -> 400');
    const invalidActionCmd = await request(server, 'POST', '/api/devices/command', {
      action: 'REBOOT_DEVICE'
    }, adminToken);
    if (invalidActionCmd.status !== 400) {
      throw new Error(`Cmd-3 Failed: Expected 400, got ${invalidActionCmd.status}`);
    }
    console.log('  -> PASS: 400 Bad Request for invalid action\n');

    // Test Cmd-4: Command with SUPERVISOR / ADMIN when device is OFFLINE -> 409 DEVICE_OFFLINE
    console.log('Test Cmd-4: POST /api/devices/command with ADMIN when device is OFFLINE -> 409');
    const offlineCmd = await request(server, 'POST', '/api/devices/command', {
      action: 'PING'
    }, adminToken);
    if (offlineCmd.status !== 409 || offlineCmd.data?.error !== 'DEVICE_OFFLINE') {
      throw new Error(`Cmd-4 Failed: Expected 409 DEVICE_OFFLINE, got ${offlineCmd.status}: ${JSON.stringify(offlineCmd.data)}`);
    }
    console.log('  -> PASS: 409 DEVICE_OFFLINE returned correctly\n');

    // Test Cmd-5: Alias POST /api/demo/device-command exact parity
    console.log('Test Cmd-5: Alias POST /api/demo/device-command parity check');
    const aliasWorkerCmd = await request(server, 'POST', '/api/demo/device-command', {
      action: 'PING'
    }, workerToken);
    if (aliasWorkerCmd.status !== 403) {
      throw new Error(`Cmd-5 Failed (Worker): Expected 403, got ${aliasWorkerCmd.status}`);
    }

    const aliasOfflineCmd = await request(server, 'POST', '/api/demo/device-command', {
      action: 'PING'
    }, adminToken);
    if (aliasOfflineCmd.status !== 409 || aliasOfflineCmd.data?.error !== 'DEVICE_OFFLINE') {
      throw new Error(`Cmd-5 Failed (Admin): Expected 409 DEVICE_OFFLINE, got ${aliasOfflineCmd.status}: ${JSON.stringify(aliasOfflineCmd.data)}`);
    }
    console.log('  -> PASS: Alias /api/demo/device-command behaves identically to /api/devices/command\n');

    // Test Cmd-6: POST /api/devices/command with unsupported deviceId -> 400
    console.log('Test Cmd-6: POST /api/devices/command with unsupported deviceId -> 400');
    const unsuppCmd = await request(server, 'POST', '/api/devices/command', {
      deviceId: 'esp32-lora-bin01',
      action: 'PING'
    }, adminToken);
    if (unsuppCmd.status !== 400 || unsuppCmd.data?.error !== 'UNSUPPORTED_DEVICE') {
      throw new Error(`Cmd-6 Failed: Expected 400 UNSUPPORTED_DEVICE, got ${unsuppCmd.status}: ${JSON.stringify(unsuppCmd.data)}`);
    }
    console.log('  -> PASS: 400 UNSUPPORTED_DEVICE for unsupported deviceId\n');

    // Test Cmd-7: Alias with unsupported deviceId -> 400
    console.log('Test Cmd-7: Alias POST /api/demo/device-command with unsupported deviceId -> 400');
    const aliasUnsuppCmd = await request(server, 'POST', '/api/demo/device-command', {
      deviceId: 'unsupported-camera-01',
      action: 'PING'
    }, adminToken);
    if (aliasUnsuppCmd.status !== 400 || aliasUnsuppCmd.data?.error !== 'UNSUPPORTED_DEVICE') {
      throw new Error(`Cmd-7 Failed: Expected 400 UNSUPPORTED_DEVICE, got ${aliasUnsuppCmd.status}: ${JSON.stringify(aliasUnsuppCmd.data)}`);
    }
    console.log('  -> PASS: Alias rejects unsupported deviceId with 400\n');

    // Test Sec-Unconf1: Production Mode + DEVICE_INGEST_TOKEN unconfigured (undefined) -> 401
    console.log('Test Sec-Unconf1: Production Mode + DEVICE_INGEST_TOKEN unconfigured -> 401');
    const savedToken = process.env.DEVICE_INGEST_TOKEN;
    delete process.env.DEVICE_INGEST_TOKEN;
    const unconfHbProd = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      uptime: 5000,
      timestamp: new Date().toISOString()
    }, 'any-bearer-token');
    if (unconfHbProd.status !== 401) {
      process.env.DEVICE_INGEST_TOKEN = savedToken;
      throw new Error(`Sec-Unconf1 Failed: Expected 401 when token unconfigured in prod, got ${unconfHbProd.status}`);
    }
    console.log('  -> PASS: 401 Unauthorized when DEVICE_INGEST_TOKEN unconfigured in Production\n');

    // Test Sec-Unconf2: Demo Mode + DEVICE_INGEST_TOKEN unconfigured -> 401
    console.log('Test Sec-Unconf2: Demo Mode + DEVICE_INGEST_TOKEN unconfigured -> 401');
    env.isDemoMode = true;
    const unconfHbDemo = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      uptime: 5000,
      timestamp: new Date().toISOString()
    }, 'any-bearer-token');
    env.isDemoMode = false;
    if (unconfHbDemo.status !== 401) {
      process.env.DEVICE_INGEST_TOKEN = savedToken;
      throw new Error(`Sec-Unconf2 Failed: Expected 401 when token unconfigured in demo, got ${unconfHbDemo.status}`);
    }
    console.log('  -> PASS: 401 Unauthorized when DEVICE_INGEST_TOKEN unconfigured in Demo\n');

    // Test Sec-Unconf3: DEVICE_INGEST_TOKEN là chuỗi rỗng -> 401
    console.log('Test Sec-Unconf3: DEVICE_INGEST_TOKEN là chuỗi rỗng -> 401');
    process.env.DEVICE_INGEST_TOKEN = '   ';
    const emptyConfigHb = await request(server, 'POST', '/api/devices/heartbeat', {
      deviceId: 'raspberry-pi-01',
      uptime: 5000,
      timestamp: new Date().toISOString()
    }, 'any-bearer-token');
    process.env.DEVICE_INGEST_TOKEN = savedToken; // Restore
    if (emptyConfigHb.status !== 401) {
      throw new Error(`Sec-Unconf3 Failed: Expected 401 when token is empty string, got ${emptyConfigHb.status}`);
    }
    console.log('  -> PASS: 401 Unauthorized when DEVICE_INGEST_TOKEN is empty string\n');

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

    console.log('\n=== ALL DEVICE REST API TESTS & REGRESSION TESTS PASSED! ===\n');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runApiTests().catch((err) => {
  console.error('API TESTS FAILED:', err);
  process.exit(1);
});
