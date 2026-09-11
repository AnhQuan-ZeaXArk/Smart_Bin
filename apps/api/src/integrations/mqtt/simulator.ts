import mqtt from 'mqtt';
import { env } from '../../config/env.js';
import { mqttTopics } from './topics.js';

if (!env.MQTT_BROKER_URL || !env.SIM_BIN_CODE) {
  throw new Error('Set MQTT_BROKER_URL and SIM_BIN_CODE before running the MQTT simulator');
}

const client = mqtt.connect(env.MQTT_BROKER_URL, { username: env.MQTT_USERNAME, password: env.MQTT_PASSWORD, clientId: `${env.MQTT_CLIENT_ID}-simulator` });
const timestamp = new Date().toISOString();

client.on('connect', () => {
  const binCode = env.SIM_BIN_CODE!;
  const messages = [
    { topic: mqttTopics.ultrasonic(binCode), payload: { binCode, distanceCm: 18.5, fillLevel: 25, timestamp } },
    { topic: mqttTopics.ultrasonic(binCode), payload: { binCode, distanceCm: 9.2, fillLevel: 80, timestamp: new Date(Date.now() + 1000).toISOString() } },
    { topic: mqttTopics.nfcScan(binCode), payload: { binCode, uid: '04:A1:B2:C3:D4:02', timestamp } }
  ];
  for (const message of messages) client.publish(message.topic, JSON.stringify(message.payload), { qos: 1 });
  console.log(`Published ${messages.length} development messages for ${binCode}`);
  client.end();
});
client.on('error', (error) => { console.error(`MQTT simulator error: ${error.message}`); client.end(); });
