import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { MqttAdapter } from './integrations/mqtt/mqtt.adapter.js';
import { RealtimeGateway } from './integrations/realtime/realtime.gateway.js';

const httpServer = createServer(app);
const realtime = new RealtimeGateway(httpServer);
const mqttAdapter = new MqttAdapter(realtime);
const port = env.PORT ?? env.API_PORT;
httpServer.listen(port, () => {
	console.log(`SmartBin API listening on port ${port}`);
	void mqttAdapter.start();
});

process.once('SIGINT', () => { void mqttAdapter.stop().finally(() => httpServer.close(() => process.exit(0))); });
process.once('SIGTERM', () => { void mqttAdapter.stop().finally(() => httpServer.close(() => process.exit(0))); });