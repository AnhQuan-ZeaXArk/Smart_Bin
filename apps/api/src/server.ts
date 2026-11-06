import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { prisma, verifyDatabaseConnection, setDatabaseReady } from './lib/prisma.js';
import { MqttAdapter } from './integrations/mqtt/mqtt.adapter.js';
import { RealtimeGateway } from './integrations/realtime/realtime.gateway.js';
import { deviceHealthService } from './services/device-health.service.js';
import { realDeviceService } from './demo/real-device.service.js';
import { settingsService } from './services/settings.service.js';

const httpServer = createServer(app);
const realtime = new RealtimeGateway(httpServer);
app.set('realtime', realtime);
app.set('io', realtime.io);
deviceHealthService.setRealtime(realtime);
realDeviceService.setRealtime(realtime);

const mqttAdapter = new MqttAdapter(realtime, deviceHealthService);
const port = Number(process.env.PORT) || env.PORT || env.API_PORT || 4000;
const host = '0.0.0.0';

let isShuttingDown = false;

async function startServer(): Promise<void> {
  console.log(`[Server] Starting SmartBin API (PID: ${process.pid})...`);
  console.log(`[Server] Configuration: NODE_ENV=${env.NODE_ENV}, Mode=${env.isDemoMode ? 'DEMO' : 'PRODUCTION'}`);

  // 1. Khởi động HTTP Server và mở cổng NGAY LẬP TỨC để Render Port Scanner nhận diện thành công
  console.log(`[Server] Binding HTTP server to http://${host}:${port}...`);
  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: Error) => {
      console.error(`[Server FATAL] Failed to bind HTTP server to ${host}:${port}:`, err.message);
      reject(err);
    };

    httpServer.once('error', onListenError);

    httpServer.listen(port, host, () => {
      // Chỉ gỡ bỏ đúng listener phục vụ kiểm tra lúc mở cổng, không xóa listener của Socket.IO/thành phần khác
      httpServer.off('error', onListenError);
      if (env.isDemoMode) {
        console.log(`[Server] SmartBin API listening on http://${host}:${port} [DEMO MODE: Standalone, No Database, No Login]`);
      } else {
        console.log(`[Server] SmartBin API listening on http://${host}:${port} [PRODUCTION MODE]`);
      }
      resolve();
    });
  });

  // Đăng ký runtime error listener riêng biệt để giám sát lỗi mạng sau khi đã listen
  httpServer.on('error', (err) => {
    console.error('[Server ERROR] Unhandled HTTP server error:', err);
  });

  // 2. Khởi tạo các dịch vụ theo chế độ vận hành
  if (env.isDemoMode) {
    realDeviceService.startMonitoring();
    console.log('[Server] RealDeviceService monitoring started (Demo mode).');
  } else {
    console.log('[Server] Connecting to database in Production Mode...');
    try {
      await verifyDatabaseConnection();
      await settingsService.getThresholds().catch((err) => {
        console.warn('[Server] Could not initialize settings from DB on startup:', err?.message || err);
      });
      deviceHealthService.startMonitoring();
      void mqttAdapter.start();
      console.log('[Server] Production background services initialized successfully.');
    } catch (error) {
      console.error(
        '[Server FATAL] Server startup aborted due to database connection failure:',
        error instanceof Error ? error.message : error
      );
      await gracefulShutdown('DATABASE_STARTUP_FAILURE', 1);
    }
  }
}

async function gracefulShutdown(signal: string, exitCode = 0): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] Received ${signal}. Shutting down gracefully (exitCode: ${exitCode})...`);

  // Thiết lập fallback timeout bảo vệ tiến trình không bị treo vô hạn lúc tắt
  const forceKillTimer = setTimeout(() => {
    console.error('[Server] Forcefully terminating due to shutdown timeout.');
    process.exit(exitCode || 1);
  }, 10000);
  forceKillTimer.unref();

  try {
    if (env.isDemoMode) {
      realDeviceService.stopMonitoring();
    } else {
      deviceHealthService.stopMonitoring();
      await mqttAdapter.stop().catch((err) => console.warn('[Server] Error stopping MQTT adapter:', err));
      setDatabaseReady(false);
      await prisma.$disconnect().catch((err) => console.warn('[Server] Error disconnecting Prisma:', err));
    }
  } catch (err) {
    console.error('[Server] Error during services teardown:', err);
  } finally {
    if (httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.close((err) => {
          if (err) {
            console.error('[Server] Error closing HTTP server:', err);
          } else {
            console.log('[Server] HTTP server closed successfully.');
          }
          resolve();
        });
      });
    } else {
      console.log('[Server] HTTP server was not listening or already closed.');
    }

    clearTimeout(forceKillTimer);
    console.log(`[Server] Teardown complete. Exiting process with code ${exitCode}.`);
    process.exit(exitCode);
  }
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

void startServer().catch((error) => {
  console.error('[Server FATAL] Server startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
