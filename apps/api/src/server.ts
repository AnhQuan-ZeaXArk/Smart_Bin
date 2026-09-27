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
const port = env.PORT ?? env.API_PORT;

httpServer.listen(port, () => {
  console.log(`SmartBin API listening on port ${port}`);
  deviceHealthService.startMonitoring();
  void mqttAdapter.start();
});

process.once('SIGINT', () => {
  deviceHealthService.stopMonitoring();
  void mqttAdapter.stop().finally(() => httpServer.close(() => process.exit(0)));
});
process.once('SIGTERM', () => {
  deviceHealthService.stopMonitoring();
  void mqttAdapter.stop().finally(() => httpServer.close(() => process.exit(0)));
});