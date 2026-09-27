import { AlertSeverity, AlertType, DeviceStatusEnum, DeviceType, type DeviceStatus } from '@prisma/client';
import { DEVICE_HEALTH_CONFIG } from '../config/device-health.config.js';
import { prisma } from '../lib/prisma.js';
import type { RealtimeGateway } from '../integrations/realtime/realtime.gateway.js';

export interface DeviceHeartbeatInput {
  deviceId: string;
  deviceName?: string;
  deviceType?: DeviceType;
  status?: DeviceStatusEnum;
  ipAddress?: string | null;
  uptime?: number | null;
  firmwareVersion?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp?: string;
}

export function computeDeviceStatus(lastSeen: Date, now: Date = new Date()): DeviceStatusEnum {
  const elapsedMs = now.getTime() - lastSeen.getTime();
  if (elapsedMs < DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS) {
    return DeviceStatusEnum.ONLINE;
  }
  if (elapsedMs < DEVICE_HEALTH_CONFIG.WARNING_THRESHOLD_MS) {
    return DeviceStatusEnum.WARNING;
  }
  return DeviceStatusEnum.OFFLINE;
}

export class DeviceHealthService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private realtime?: RealtimeGateway) {}

  setRealtime(realtime: RealtimeGateway): void {
    this.realtime = realtime;
  }

  startMonitoring(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.evaluateAllDevices();
    }, DEVICE_HEALTH_CONFIG.CHECK_INTERVAL_MS);
  }

  stopMonitoring(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getAllDevices(): Promise<DeviceStatus[]> {
    await this.evaluateAllDevices();
    return prisma.deviceStatus.findMany({
      orderBy: { createdAt: 'asc' }
    });
  }

  async getDeviceById(idOrDeviceId: string): Promise<DeviceStatus | null> {
    const device = await prisma.deviceStatus.findFirst({
      where: {
        OR: [{ id: idOrDeviceId }, { deviceId: idOrDeviceId }]
      }
    });
    if (!device) return null;

    const evaluatedStatus = computeDeviceStatus(device.lastSeen);
    if (evaluatedStatus !== device.status) {
      return this.updateDeviceStatus(device, evaluatedStatus);
    }
    return device;
  }

  async recordHeartbeat(input: DeviceHeartbeatInput): Promise<DeviceStatus> {
    const timestamp = input.timestamp ? new Date(input.timestamp) : new Date();
    const existing = await prisma.deviceStatus.findUnique({
      where: { deviceId: input.deviceId }
    });

    const metadataStr = input.metadata ? JSON.stringify(input.metadata) : null;

    let device: DeviceStatus;
    if (existing) {
      const wasOffline = existing.status === DeviceStatusEnum.OFFLINE;
      device = await prisma.deviceStatus.update({
        where: { id: existing.id },
        data: {
          status: DeviceStatusEnum.ONLINE,
          lastSeen: timestamp,
          lastHeartbeat: timestamp,
          ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
          ...(input.uptime !== undefined ? { uptime: input.uptime } : {}),
          ...(input.firmwareVersion !== undefined ? { firmwareVersion: input.firmwareVersion } : {}),
          ...(metadataStr !== null ? { metadata: metadataStr } : {})
        }
      });

      if (wasOffline) {
        await this.resolveDeviceAlert(device.deviceName);
      }
    } else {
      device = await prisma.deviceStatus.create({
        data: {
          deviceId: input.deviceId,
          deviceName: input.deviceName ?? input.deviceId,
          deviceType: input.deviceType ?? DeviceType.RASPBERRY_PI,
          status: DeviceStatusEnum.ONLINE,
          lastSeen: timestamp,
          lastHeartbeat: timestamp,
          ipAddress: input.ipAddress ?? null,
          uptime: input.uptime ?? null,
          firmwareVersion: input.firmwareVersion ?? null,
          metadata: metadataStr
        }
      });
    }

    this.realtime?.emitDeviceStatus(device);
    return device;
  }

  async recordDeviceActivity(
    deviceId: string,
    defaultType: DeviceType,
    defaultName: string,
    metadata?: Record<string, unknown>
  ): Promise<DeviceStatus> {
    const now = new Date();
    const existing = await prisma.deviceStatus.findUnique({
      where: { deviceId }
    });

    const metadataStr = metadata ? JSON.stringify(metadata) : null;

    let device: DeviceStatus;
    if (existing) {
      const wasOffline = existing.status === DeviceStatusEnum.OFFLINE;
      device = await prisma.deviceStatus.update({
        where: { id: existing.id },
        data: {
          status: DeviceStatusEnum.ONLINE,
          lastSeen: now,
          ...(metadataStr ? { metadata: metadataStr } : {})
        }
      });

      if (wasOffline) {
        await this.resolveDeviceAlert(device.deviceName);
      }
    } else {
      device = await prisma.deviceStatus.create({
        data: {
          deviceId,
          deviceName: defaultName,
          deviceType: defaultType,
          status: DeviceStatusEnum.ONLINE,
          lastSeen: now,
          metadata: metadataStr
        }
      });
    }

    this.realtime?.emitDeviceStatus(device);
    return device;
  }

  async setDeviceStatus(deviceId: string, status: DeviceStatusEnum, metadata?: Record<string, unknown>): Promise<DeviceStatus | null> {
    const existing = await prisma.deviceStatus.findUnique({
      where: { deviceId }
    });
    if (!existing) return null;

    const previousStatus = existing.status;
    const now = new Date();
    const metadataStr = metadata ? JSON.stringify(metadata) : existing.metadata;

    // Avoid redundant updates if already in the target state with no new metadata
    if (previousStatus === status && metadataStr === existing.metadata && status !== DeviceStatusEnum.ONLINE) {
      return existing;
    }

    const updated = await prisma.deviceStatus.update({
      where: { id: existing.id },
      data: {
        status,
        lastSeen: status === DeviceStatusEnum.ONLINE ? now : existing.lastSeen,
        metadata: metadataStr
      }
    });

    if (previousStatus !== status) {
      if (status === DeviceStatusEnum.OFFLINE) {
        await this.createDeviceAlert(updated.deviceName);
      } else if (status === DeviceStatusEnum.ONLINE) {
        await this.resolveDeviceAlert(updated.deviceName);
      }
    }

    this.realtime?.emitDeviceStatus(updated);
    return updated;
  }

  async evaluateAllDevices(): Promise<void> {
    const devices = await prisma.deviceStatus.findMany();
    const now = new Date();

    for (const device of devices) {
      // Don't auto-downgrade MQTT device based purely on lastSeen if adapter maintains state
      if (device.deviceType === DeviceType.MQTT) continue;

      const newStatus = computeDeviceStatus(device.lastSeen, now);
      if (newStatus !== device.status) {
        await this.updateDeviceStatus(device, newStatus);
      }
    }
  }

  private async updateDeviceStatus(device: DeviceStatus, newStatus: DeviceStatusEnum): Promise<DeviceStatus> {
    const previousStatus = device.status;
    const updated = await prisma.deviceStatus.update({
      where: { id: device.id },
      data: { status: newStatus }
    });

    if (previousStatus !== newStatus) {
      if (newStatus === DeviceStatusEnum.OFFLINE) {
        await this.createDeviceAlert(device.deviceName);
      } else if (newStatus === DeviceStatusEnum.ONLINE && previousStatus === DeviceStatusEnum.OFFLINE) {
        await this.resolveDeviceAlert(device.deviceName);
      }
      this.realtime?.emitDeviceStatus(updated);
    }

    return updated;
  }

  private async createDeviceAlert(deviceName: string): Promise<void> {
    const existing = await prisma.alert.findFirst({
      where: {
        type: AlertType.DEVICE_OFFLINE,
        isResolved: false,
        message: { contains: deviceName }
      }
    });

    if (!existing) {
      const alert = await prisma.alert.create({
        data: {
          type: AlertType.DEVICE_OFFLINE,
          severity: AlertSeverity.CRITICAL,
          message: `Thiết bị ${deviceName} mất kết nối (không nhận dữ liệu trong ${DEVICE_HEALTH_CONFIG.OFFLINE_THRESHOLD_MS / 1000} giây).`
        }
      });
      this.realtime?.emitAlert(alert);
    }
  }

  private async resolveDeviceAlert(deviceName: string): Promise<void> {
    const alertsToResolve = await prisma.alert.findMany({
      where: {
        type: AlertType.DEVICE_OFFLINE,
        isResolved: false,
        message: { contains: deviceName }
      }
    });

    if (alertsToResolve.length > 0) {
      const now = new Date();
      await prisma.alert.updateMany({
        where: {
          id: { in: alertsToResolve.map((a) => a.id) }
        },
        data: {
          isResolved: true,
          resolvedAt: now
        }
      });

      for (const alert of alertsToResolve) {
        this.realtime?.emitAlertResolved({
          ...alert,
          isResolved: true,
          resolvedAt: now
        });
      }
    }
  }
}

export const deviceHealthService = new DeviceHealthService();

