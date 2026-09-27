import mqtt, { type MqttClient } from 'mqtt';
import { DeviceStatusEnum, DeviceType } from '@prisma/client';
import { env } from '../../config/env.js';
import { deviceHeartbeatSchema, deviceStatusSchema, ultrasonicTelemetrySchema } from './contracts.js';
import { parseSmartBinTopic } from './topics.js';
import { ingestUltrasonicTelemetry } from '../../services/telemetry.service.js';
import type { DeviceHealthService } from '../../services/device-health.service.js';
import { prisma } from '../../lib/prisma.js';
import type { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { getFillCategory } from '../../routes/bin.routes.js';

export const MQTT_SUBSCRIPTIONS = [
  'smartbin/+/telemetry',
  'smartbin/+/sensor/ultrasonic',
  'smartbin/+/device/heartbeat',
  'smartbin/device/heartbeat',
  'smartbin/+/status'
] as const;

export class MqttAdapter {
  private client: MqttClient | null = null;

  constructor(
    private readonly realtime?: RealtimeGateway,
    private readonly deviceHealthService?: DeviceHealthService,
    client?: MqttClient
  ) {
    if (client) {
      this.client = client;
      this.setupClientEvents(client);
    }
  }

  getClient(): MqttClient | null {
    return this.client;
  }

  getSubscriptions(): readonly string[] {
    return MQTT_SUBSCRIPTIONS;
  }

  setupClientEvents(client: MqttClient): void {
    client.on('connect', () => {
      console.log(`MQTT connected to ${env.MQTT_BROKER_URL || 'broker'}`);
      void this.deviceHealthService?.setDeviceStatus('mqtt-broker-01', DeviceStatusEnum.ONLINE, {
        brokerUrl: env.MQTT_BROKER_URL
      });
      client.subscribe(MQTT_SUBSCRIPTIONS as unknown as string[], (error) => {
        if (error) console.error('MQTT subscribe failed', error.message);
      });
    });

    client.on('reconnect', () => {
      console.log('MQTT reconnected / reconnecting');
      void this.deviceHealthService?.setDeviceStatus('mqtt-broker-01', DeviceStatusEnum.ONLINE, {
        brokerUrl: env.MQTT_BROKER_URL
      });
    });

    client.on('offline', () => {
      console.warn('MQTT offline');
      void this.deviceHealthService?.setDeviceStatus('mqtt-broker-01', DeviceStatusEnum.OFFLINE, {
        reason: 'Broker offline'
      });
    });

    client.on('close', () => {
      console.warn('MQTT connection closed');
      void this.deviceHealthService?.setDeviceStatus('mqtt-broker-01', DeviceStatusEnum.OFFLINE, {
        reason: 'Connection closed'
      });
    });

    client.on('error', (error) => {
      console.error('MQTT error', error.message);
      void this.deviceHealthService?.setDeviceStatus('mqtt-broker-01', DeviceStatusEnum.OFFLINE, {
        error: error.message
      });
    });

    client.on('message', (topic, payload) => {
      void this.handleMessage(topic, payload.toString());
    });
  }

  async start(): Promise<void> {
    if (!env.MQTT_BROKER_URL) {
      console.log('MQTT disabled: MQTT_BROKER_URL is not configured');
      void this.deviceHealthService?.setDeviceStatus('mqtt-broker-01', DeviceStatusEnum.OFFLINE, {
        reason: 'MQTT_BROKER_URL is not configured'
      });
      return;
    }

    if (!this.client) {
      this.client = mqtt.connect(env.MQTT_BROKER_URL, {
        username: env.MQTT_USERNAME,
        password: env.MQTT_PASSWORD,
        clientId: env.MQTT_CLIENT_ID,
        reconnectPeriod: 5000,
        connectTimeout: 10000
      });
      this.setupClientEvents(this.client);
    }
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
    void this.deviceHealthService?.setDeviceStatus('mqtt-broker-01', DeviceStatusEnum.OFFLINE, {
      reason: 'Adapter stopped'
    });
  }

  publish(topic: string, payload: unknown): boolean {
    if (!this.client?.connected) {
      console.warn(`MQTT publish skipped because broker is unavailable: ${topic}`);
      return false;
    }
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => {
      if (error) console.error('MQTT publish failed', error.message);
    });
    return true;
  }

  async handleMessage(topic: string, rawPayload: string): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      console.warn(`MQTT message rejected: invalid JSON on ${topic}`);
      return;
    }

    if (topic === 'smartbin/device/heartbeat') {
      const parsed = deviceHeartbeatSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn(`Invalid heartbeat message on ${topic}:`, parsed.error.issues.map((i) => i.message).join(', '));
        return;
      }
      try {
        await this.deviceHealthService?.recordHeartbeat(parsed.data);
      } catch (e) {
        console.warn(`Failed to record heartbeat on ${topic}:`, e instanceof Error ? e.message : e);
      }
      return;
    }

    const parsedTopic = parseSmartBinTopic(topic);
    if (!parsedTopic) {
      console.warn(`MQTT message rejected: invalid topic ${topic}`);
      return;
    }

    try {
      if (typeof payload === 'object' && payload !== null && 'binCode' in payload && payload.binCode !== parsedTopic.binCode) {
        console.warn(`MQTT message rejected on ${topic}: payload binCode does not match topic`);
        return;
      }

      if (parsedTopic.channel === 'telemetry' || parsedTopic.channel === 'sensor/ultrasonic') {
        const parsed = ultrasonicTelemetrySchema.safeParse({ ...(payload as object), binCode: parsedTopic.binCode });
        if (!parsed.success) {
          console.warn(`Invalid ultrasonic telemetry on ${topic}:`, parsed.error.issues.map((i) => i.message).join(', '));
          return;
        }
        const message = parsed.data;
        const result = await ingestUltrasonicTelemetry(message, this.deviceHealthService);
        if (!result.accepted) {
          console.warn(`Telemetry rejected for ${result.binCode}: ${result.reason}`);
        } else {
          this.realtime?.emitTelemetry({
            binCode: message.binCode,
            fillLevel: message.fillLevel,
            currentFillLevel: message.fillLevel,
            fillCategory: getFillCategory(message.fillLevel),
            distanceCm: message.distanceCm,
            distance: message.distanceCm,
            deviceId: message.deviceId ?? 'ultrasonic-01',
            timestamp: message.timestamp
          });
        }
        if (result.alert) this.realtime?.emitAlert(result.alert);
        return;
      }

      if (parsedTopic.channel === 'device/heartbeat') {
        const parsed = deviceHeartbeatSchema.safeParse(payload);
        if (!parsed.success) {
          console.warn(`Invalid heartbeat message on ${topic}:`, parsed.error.issues.map((i) => i.message).join(', '));
          return;
        }
        await this.deviceHealthService?.recordHeartbeat(parsed.data);
        return;
      }

      if (parsedTopic.channel === 'status') {
        const parsed = deviceStatusSchema.safeParse({ ...(payload as object), binCode: parsedTopic.binCode });
        if (!parsed.success) {
          console.warn(`Invalid status message on ${topic}:`, parsed.error.issues.map((i) => i.message).join(', '));
          return;
        }
        const message = parsed.data;
        const bin = await prisma.bin.findUnique({ where: { binCode: message.binCode } });
        if (bin?.isActive) {
          await prisma.bin.update({
            where: { id: bin.id },
            data: { status: message.status, lastSeen: new Date(message.timestamp) }
          });
        }
        return;
      }
    } catch (error) {
      console.warn(`MQTT message error on ${topic}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}
