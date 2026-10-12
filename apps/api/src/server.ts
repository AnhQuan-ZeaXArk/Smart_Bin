import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { MqttAdapter } from './integrations/mqtt/mqtt.adapter.js';
import { RealtimeGateway } from './integrations/realtime/realtime.gateway.js';
import { deviceHealthService } from './services/device-health.service.js';

const httpServer = createServer(app);
const realtime = new RealtimeGateway(httpServer);
deviceHealthService.setRealtime(realtime);
const mqttAdapter = new MqttAdapter(realtime, deviceHealthService);
const port = Number(process.env.PORT) || env.PORT || env.API_PORT || 4000;
const host = '0.0.0.0';

httpServer.listen(port, host, () => {
  if (env.isDemoMode) {
    console.log(`SmartBin API listening on http://${host}:${port} [DEMO MODE: Standalone, No Database, No Login]`);
  } else {
    console.log(`SmartBin API listening on http://${host}:${port} [PRODUCTION MODE]`);
    deviceHealthService.startMonitoring();
    void mqttAdapter.start();
  }
});

process.once('SIGINT', () => {
  if (!env.isDemoMode) {
    deviceHealthService.stopMonitoring();
    void mqttAdapter.stop().finally(() => httpServer.close(() => process.exit(0)));
  } else {
    httpServer.close(() => process.exit(0));
  }
});
process.once('SIGTERM', () => {
  if (!env.isDemoMode) {
    deviceHealthService.stopMonitoring();
    void mqttAdapter.stop().finally(() => httpServer.close(() => process.exit(0)));
  } else {
    httpServer.close(() => process.exit(0));
  }
});