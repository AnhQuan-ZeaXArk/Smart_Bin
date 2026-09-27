import mqtt from 'mqtt';
import { env } from '../../config/env.js';
import { mqttTopics } from './topics.js';

if (!env.MQTT_BROKER_URL) {
  throw new Error('Set MQTT_BROKER_URL before running the MQTT simulator');
}

const binCode = env.SIM_BIN_CODE || 'ORGANIC';
const runOnce = process.argv.includes('--once');
const INTERVAL_MS = 8000; // 8 seconds (within recommended 5-10s range)

const client = mqtt.connect(env.MQTT_BROKER_URL, {
  username: env.MQTT_USERNAME,
  password: env.MQTT_PASSWORD,
  clientId: `${env.MQTT_CLIENT_ID || 'smartbin'}-simulator`
});

let uptimeSeconds = 3600;
let step = 0;
let timer: NodeJS.Timeout | null = null;

function publishCycle(): void {
  const timestamp = new Date().toISOString();
  uptimeSeconds += Math.round(INTERVAL_MS / 1000);
  step++;

  // Alternate fill level to simulate usage: 20% -> 45% -> 70% -> 30%
  const simulatedFillLevels = [25, 48, 72, 85, 30];
  const fillLevel = simulatedFillLevels[step % simulatedFillLevels.length];
  const distanceCm = Number((100 - fillLevel * 0.8).toFixed(1));

  const messages = [
    // 1. Ultrasonic telemetry
    {
      topic: mqttTopics.ultrasonic(binCode),
      payload: {
        binCode,
        distanceCm,
        fillLevel,
        timestamp,
        deviceId: 'ultrasonic-01'
      }
    },
    // 2. Raspberry Pi 5 Gateway heartbeat
    {
      topic: mqttTopics.systemHeartbeat,
      payload: {
        deviceId: 'raspberry-pi-01',
        deviceName: 'Raspberry Pi 5 Gateway',
        deviceType: 'RASPBERRY_PI',
        status: 'ONLINE',
        ipAddress: '192.168.1.150',
        uptime: uptimeSeconds,
        firmwareVersion: '1.0.0',
        timestamp
      }
    },
    // 3. Camera AI heartbeat
    {
      topic: mqttTopics.systemHeartbeat,
      payload: {
        deviceId: 'camera-01',
        deviceName: 'Camera AI',
        deviceType: 'CAMERA',
        status: 'ONLINE',
        metadata: {
          aiModel: 'YOLOv8-Waste',
          confidence: 0.94
        },
        timestamp
      }
    }
  ];

  for (const message of messages) {
    client.publish(message.topic, JSON.stringify(message.payload), { qos: 1 });
  }

  console.log(`[Simulator cycle ${step}] Sent telemetry (fill: ${fillLevel}%) & heartbeats (RPi5 uptime: ${uptimeSeconds}s, Camera AI)`);
}

client.on('connect', () => {
  console.log(`MQTT simulator connected to ${env.MQTT_BROKER_URL} (Target bin: ${binCode}, interval: ${INTERVAL_MS / 1000}s)`);
  publishCycle();

  if (runOnce) {
    console.log('Simulator completed one-shot cycle (--once). Disconnecting.');
    client.end();
    return;
  }

  timer = setInterval(() => {
    publishCycle();
  }, INTERVAL_MS);
});

client.on('error', (error) => {
  console.error(`MQTT simulator error: ${error.message}`);
  if (timer) clearInterval(timer);
  client.end();
});

function shutdown(): void {
  console.log('\nStopping MQTT simulator...');
  if (timer) clearInterval(timer);
  client.end(false, {}, () => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
