import type { RealtimeGateway } from '../integrations/realtime/realtime.gateway.js';

export interface HeartbeatPayload {
  deviceId: string;
  status?: string;
  uptimeSeconds: number;
  cpuTempC?: number | null;
  sentAt?: string;
}

export type RealDeviceStatusType = 'ONLINE' | 'STALE' | 'OFFLINE';

export interface RealDeviceStatus {
  deviceId: string;
  deviceName: string;
  deviceType: 'RASPBERRY_PI';
  isReal: true;
  status: RealDeviceStatusType;
  uptimeSeconds: number;
  cpuTempC: number | null;
  lastHeartbeat: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  heartbeatCount: number;
  ageSeconds: number | null;
  metadata?: {
    staleThresholdSeconds: number;
    offlineThresholdSeconds: number;
    platform?: string;
  };
}

export class RealDeviceService {
  private realtime?: RealtimeGateway;
  private timer: NodeJS.Timeout | null = null;

  // In-memory state for real Raspberry Pi 5
  private deviceId: string = 'raspberry-pi-5';
  private deviceName: string = 'Raspberry Pi 5 (Phần cứng thực tế)';
  private lastHeartbeatDate: Date | null = null;
  private uptimeSeconds: number = 0;
  private cpuTempC: number | null = null;
  private heartbeatCount: number = 0;
  private lastSentAt: string | null = null;
  private lastReceivedAt: string | null = null;
  private previousStatus: RealDeviceStatusType = 'OFFLINE';

  // Configurable thresholds for stale and offline detection
  public readonly STALE_THRESHOLD_SECONDS = 45;
  public readonly OFFLINE_THRESHOLD_SECONDS = 90;
  private readonly CHECK_INTERVAL_MS = 10000;

  setRealtime(realtime: RealtimeGateway): void {
    this.realtime = realtime;
  }

  startMonitoring(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.evaluateStatusChange();
    }, this.CHECK_INTERVAL_MS);
  }

  stopMonitoring(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  recordHeartbeat(input: HeartbeatPayload): RealDeviceStatus {
    const now = new Date();
    this.deviceId = input.deviceId || this.deviceId;
    this.lastHeartbeatDate = now;
    this.lastReceivedAt = now.toISOString();
    this.lastSentAt = input.sentAt || this.lastReceivedAt;
    this.uptimeSeconds = Math.max(0, Math.floor(input.uptimeSeconds));
    this.cpuTempC = typeof input.cpuTempC === 'number' && !Number.isNaN(input.cpuTempC)
      ? Math.round(input.cpuTempC * 10) / 10
      : null;
    this.heartbeatCount += 1;

    const statusObj = this.getStatus();
    this.previousStatus = statusObj.status;

    // Broadcast realtime event 'device:heartbeat'
    if (this.realtime?.io) {
      this.realtime.io.emit('device:heartbeat', statusObj);
    }

    return statusObj;
  }

  getStatus(): RealDeviceStatus {
    const now = Date.now();
    let computedStatus: RealDeviceStatusType = 'OFFLINE';
    let ageSeconds: number | null = null;

    if (this.lastHeartbeatDate) {
      ageSeconds = Math.max(0, Math.floor((now - this.lastHeartbeatDate.getTime()) / 1000));
      if (ageSeconds <= this.STALE_THRESHOLD_SECONDS) {
        computedStatus = 'ONLINE';
      } else if (ageSeconds <= this.OFFLINE_THRESHOLD_SECONDS) {
        computedStatus = 'STALE';
      } else {
        computedStatus = 'OFFLINE';
      }
    }

    return {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      deviceType: 'RASPBERRY_PI',
      isReal: true,
      status: computedStatus,
      uptimeSeconds: this.uptimeSeconds,
      cpuTempC: this.cpuTempC,
      lastHeartbeat: this.lastHeartbeatDate ? this.lastHeartbeatDate.toISOString() : null,
      receivedAt: this.lastReceivedAt,
      sentAt: this.lastSentAt,
      heartbeatCount: this.heartbeatCount,
      ageSeconds,
      metadata: {
        staleThresholdSeconds: this.STALE_THRESHOLD_SECONDS,
        offlineThresholdSeconds: this.OFFLINE_THRESHOLD_SECONDS,
        platform: 'Raspberry Pi 5'
      }
    };
  }

  private evaluateStatusChange(): void {
    if (!this.lastHeartbeatDate) return;
    const currentStatusObj = this.getStatus();
    if (currentStatusObj.status !== this.previousStatus) {
      this.previousStatus = currentStatusObj.status;
      if (this.realtime?.io) {
        this.realtime.io.emit('device:heartbeat', currentStatusObj);
      }
    }
  }

  reset(): void {
    this.lastHeartbeatDate = null;
    this.uptimeSeconds = 0;
    this.cpuTempC = null;
    this.heartbeatCount = 0;
    this.lastSentAt = null;
    this.lastReceivedAt = null;
    this.previousStatus = 'OFFLINE';
  }
}

export const realDeviceService = new RealDeviceService();
