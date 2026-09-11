import mqtt, { type MqttClient } from 'mqtt';
import { env } from '../../config/env.js';
import { deviceStatusSchema, nfcScanSchema, ultrasonicTelemetrySchema } from './contracts.js';
import { parseSmartBinTopic, mqttTopics } from './topics.js';
import { authenticateNfcUid } from '../../services/nfc-auth.service.js';
import { ingestUltrasonicTelemetry } from '../../services/telemetry.service.js';
import { prisma } from '../../lib/prisma.js';
import type { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { getFillCategory } from '../../routes/bin.routes.js';

const subscriptions = ['smartbin/+/telemetry', 'smartbin/+/sensor/ultrasonic', 'smartbin/+/nfc/scan', 'smartbin/+/status'];

export class MqttAdapter {
  private client: MqttClient | null = null;
  constructor(private readonly realtime?: RealtimeGateway) {}

  async start(): Promise<void> {
    if (!env.MQTT_BROKER_URL) {
      console.log('MQTT disabled: MQTT_BROKER_URL is not configured');
      return;
    }
    this.client = mqtt.connect(env.MQTT_BROKER_URL, {
      username: env.MQTT_USERNAME,
      password: env.MQTT_PASSWORD,
      clientId: env.MQTT_CLIENT_ID,
      reconnectPeriod: 5000,
      connectTimeout: 10000
    });
    this.client.on('connect', () => {
      console.log(`MQTT connected to ${env.MQTT_BROKER_URL}`);
      this.client?.subscribe(subscriptions, (error) => { if (error) console.error('MQTT subscribe failed', error.message); });
    });
    this.client.on('reconnect', () => console.warn('MQTT reconnecting'));
    this.client.on('error', (error) => console.error('MQTT error', error.message));
    this.client.on('message', (topic, payload) => { void this.handleMessage(topic, payload.toString()); });
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    await new Promise<void>((resolve) => this.client!.end(false, {}, () => resolve()));
    this.client = null;
  }

  publish(topic: string, payload: unknown): boolean {
    if (!this.client?.connected) {
      console.warn(`MQTT publish skipped because broker is unavailable: ${topic}`);
      return false;
    }
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => { if (error) console.error('MQTT publish failed', error.message); });
    return true;
  }

  publishLockCommand(binCode: string, command: { action: 'OPEN' | 'CLOSE'; requestId: string; timestamp: string }): boolean {
    return this.publish(mqttTopics.lockCommand(binCode), command);
  }

  private async handleMessage(topic: string, rawPayload: string): Promise<void> {
    const parsedTopic = parseSmartBinTopic(topic);
    if (!parsedTopic) return console.warn(`MQTT message rejected: invalid topic ${topic}`);
    let payload: unknown;
    try { payload = JSON.parse(rawPayload); } catch { return console.warn(`MQTT message rejected: invalid JSON on ${topic}`); }
    try {
      if (typeof payload === 'object' && payload !== null && 'binCode' in payload && payload.binCode !== parsedTopic.binCode) {
        return console.warn(`MQTT message rejected on ${topic}: payload binCode does not match topic`);
      }
      if (parsedTopic.channel === 'telemetry' || parsedTopic.channel === 'sensor/ultrasonic') {
        const message = ultrasonicTelemetrySchema.parse({ ...(payload as object), binCode: parsedTopic.binCode });
        const result = await ingestUltrasonicTelemetry(message);
        if (!result.accepted) console.warn(`Telemetry rejected for ${result.binCode}: ${result.reason}`);
        else this.realtime?.emitTelemetry({ binCode: message.binCode, fillLevel: message.fillLevel, fillCategory: getFillCategory(message.fillLevel), distanceCm: message.distanceCm, timestamp: message.timestamp });
        if (result.alert) this.realtime?.emitAlert(result.alert);
        return;
      }
      if (parsedTopic.channel === 'nfc/scan') {
        const message = nfcScanSchema.parse({ ...(payload as object), binCode: parsedTopic.binCode });
        const bin = await prisma.bin.findUnique({ where: { binCode: message.binCode } });
        if (!bin || !bin.isActive) return console.warn(`NFC scan rejected for unknown or inactive bin ${message.binCode}`);
        const result = await authenticateNfcUid(message.uid, message.binCode);
        this.publish(mqttTopics.nfcResult(message.binCode), { result: result.result, reason: result.reason, action: 'AUTHENTICATE', uid: result.uid, timestamp: new Date().toISOString() });
        this.realtime?.emitNfcAccess({ binCode: message.binCode, uid: result.uid, result: result.result, reason: result.reason, employeeId: result.employeeId, timestamp: new Date().toISOString() });
        return;
      }
      if (parsedTopic.channel === 'status') {
        const message = deviceStatusSchema.parse({ ...(payload as object), binCode: parsedTopic.binCode });
        const bin = await prisma.bin.findUnique({ where: { binCode: message.binCode } });
        if (bin?.isActive) await prisma.bin.update({ where: { id: bin.id }, data: { status: message.status, lastSeen: new Date(message.timestamp) } });
      }
    } catch (error) {
      console.warn(`MQTT message rejected on ${topic}: ${error instanceof Error ? error.message : 'validation error'}`);
    }
  }
}
