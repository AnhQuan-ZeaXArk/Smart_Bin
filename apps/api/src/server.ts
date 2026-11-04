import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { prisma, verifyDatabaseConnection } from './lib/prisma.js';
import { MqttAdapter } from './integrations/mqtt/mqtt.adapter.js';
import { RealtimeGateway } from './integrations/realtime/realtime.gateway.js';
import { deviceHealthService } from './services/device-health.service.js';
import { realDeviceService } from './demo/real-device.service.js';

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
  if (env.isDemoMode) {
    realDeviceService.startMonitoring();
  } else {
    console.log('[Server] Connecting to database in Production Mode...');
    await verifyDatabaseConnection();
    deviceHealthService.startMonitoring();
    void mqttAdapter.start();
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      if (env.isDemoMode) {
        console.log(`SmartBin API listening on http://${host}:${port} [DEMO MODE: Standalone, No Database, No Login]`);
      } else {
        console.log(`SmartBin API listening on http://${host}:${port} [PRODUCTION MODE]`);
      }
      resolve();
    });
  });
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] Received ${signal}. Shutting down gracefully...`);

  try {
    if (env.isDemoMode) {
      realDeviceService.stopMonitoring();
    } else {
      deviceHealthService.stopMonitoring();
      await mqttAdapter.stop().catch((err) => console.warn('[Server] Error stopping MQTT adapter:', err));
      await prisma.$disconnect().catch((err) => console.warn('[Server] Error disconnecting Prisma:', err));
    }
  } catch (err) {
    console.error('[Server] Error during services teardown:', err);
  } finally {
    httpServer.close((err) => {
      if (err) {
        console.error('[Server] Error closing HTTP server:', err);
        process.exit(1);
      }
      console.log('[Server] HTTP server closed successfully.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[Server] Forcefully terminating due to shutdown timeout.');
      process.exit(1);
    }, 10000).unref();
  }
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

void startServer().catch((error) => {
  console.error('[Server FATAL] Server startup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
