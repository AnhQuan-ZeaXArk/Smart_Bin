import type { RealtimeGateway } from '../integrations/realtime/realtime.gateway.js';
import {
  REALTIME_EVENTS,
  type DeviceCommandAckPayload,
  type DeviceCommandPayload,
  type DeviceCommandStatusPayload
} from '../integrations/realtime/realtime.contract.js';

export interface DeviceSensorsData {
  distanceCm?: number | null;
  fillLevel?: number | null;
}

export interface HeartbeatPayload {
  deviceId: string;
  status?: string;
  uptimeSeconds: number;
  cpuTempC?: number | null;
  sentAt?: string;
  sensors?: DeviceSensorsData | null;
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
  isSocketConnected: boolean;
  sensors?: DeviceSensorsData | null;
  metadata?: {
    staleThresholdSeconds: number;
    offlineThresholdSeconds: number;
    platform?: string;
  };
}

interface PendingCommand {
  commandId: string;
  action: 'PING' | 'TRIGGER_ULTRASONIC';
  deviceId: string;
  resolve: (value: DeviceCommandAckPayload & { latencyMs: number }) => void;
  reject: (reason: any) => void;
  timeoutTimer: NodeJS.Timeout;
  startedAt: number;
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
  private isSocketConnected: boolean = false;
  private sensors: DeviceSensorsData | null = null;

  // Active command pending registry
  private pendingCommands = new Map<string, PendingCommand>();

  // Configurable thresholds for stale and offline detection
  public readonly STALE_THRESHOLD_SECONDS = 45;
  public readonly OFFLINE_THRESHOLD_SECONDS = 90;
  private readonly CHECK_INTERVAL_MS = 10000;

  setRealtime(realtime: RealtimeGateway): void {
    this.realtime = realtime;
  }

  setSocketConnected(deviceId: string, connected: boolean): void {
    if (this.deviceId === deviceId || !this.deviceId) {
      this.isSocketConnected = connected;
      if (connected) {
        // If connecting via Socket.IO, mark device as seen immediately
        const now = new Date();
        this.lastHeartbeatDate = now;
        this.lastReceivedAt = now.toISOString();
      }
      this.evaluateStatusChange();
    }
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
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timeoutTimer);
      pending.reject(new Error('RealDeviceService monitoring stopped'));
    }
    this.pendingCommands.clear();
  }

  recordHeartbeat(input: HeartbeatPayload, fallbackIo?: any): RealDeviceStatus {
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

    if (input.sensors !== undefined) {
      this.sensors = input.sensors;
    }

    const statusObj = this.getStatus();
    this.previousStatus = statusObj.status;

    // Broadcast realtime event 'device:heartbeat'
    const ioEmitter = this.realtime?.io || fallbackIo;
    if (ioEmitter) {
      ioEmitter.emit(REALTIME_EVENTS.DEVICE_HEARTBEAT, statusObj);
      console.log(`[RealDeviceService] Broadcasted 'device:heartbeat' for ${this.deviceId} (#${this.heartbeatCount}, status=${statusObj.status}, uptime=${statusObj.uptimeSeconds}s, socket=${this.isSocketConnected})`);
    } else {
      console.warn(`[RealDeviceService] Warning: Socket.IO emitter not ready when recording heartbeat #${this.heartbeatCount}`);
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
      isSocketConnected: this.isSocketConnected,
      sensors: this.sensors,
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
        this.realtime.io.emit(REALTIME_EVENTS.DEVICE_HEARTBEAT, currentStatusObj);
      }
    }
  }

  /**
   * Dispatch a safe command to Raspberry Pi 5
   * Only PING and TRIGGER_ULTRASONIC are permitted.
   */
  async dispatchCommand(
    action: 'PING' | 'TRIGGER_ULTRASONIC',
    params: Record<string, unknown> = {},
    timeoutMs = 8000
  ): Promise<DeviceCommandAckPayload & { latencyMs: number }> {
    const currentStatus = this.getStatus();
    if (currentStatus.status === 'OFFLINE') {
      const err = new Error(`Thiết bị ${this.deviceId} đang OFFLINE. Không thể gửi lệnh.`);
      (err as any).code = 'DEVICE_OFFLINE';
      throw err;
    }

    const io = this.realtime?.io;
    if (!io) {
      const err = new Error('Socket.IO Gateway chưa sẵn sàng');
      (err as any).code = 'GATEWAY_UNAVAILABLE';
      throw err;
    }

    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = Date.now();
    const issuedAt = new Date().toISOString();

    const commandPayload: DeviceCommandPayload = {
      commandId,
      deviceId: this.deviceId,
      action,
      params,
      issuedAt
    };

    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        const timeoutStatus: DeviceCommandStatusPayload = {
          commandId,
          deviceId: this.deviceId,
          action,
          status: 'TIMEOUT',
          message: `Lệnh ${action} đã hết hạn thời gian phản hồi (${timeoutMs / 1000}s)`,
          latencyMs: Date.now() - startedAt,
          updatedAt: new Date().toISOString()
        };
        io.emit(REALTIME_EVENTS.DEVICE_COMMAND_STATUS, timeoutStatus);

        const timeoutErr = new Error(`Hết thời gian phản hồi từ Raspberry Pi 5 (${timeoutMs}ms)`);
        (timeoutErr as any).code = 'COMMAND_TIMEOUT';
        reject(timeoutErr);
      }, timeoutMs);

      this.pendingCommands.set(commandId, {
        commandId,
        action,
        deviceId: this.deviceId,
        resolve,
        reject,
        timeoutTimer,
        startedAt
      });

      // Emit pending status to Web
      const pendingStatus: DeviceCommandStatusPayload = {
        commandId,
        deviceId: this.deviceId,
        action,
        status: 'PENDING',
        message: `Đang gửi lệnh ${action} đến Raspberry Pi 5...`,
        latencyMs: 0,
        updatedAt: issuedAt
      };
      io.emit(REALTIME_EVENTS.DEVICE_COMMAND_STATUS, pendingStatus);

      // Emit command specifically to device room
      io.to(`device:${this.deviceId}`).to('device').emit(REALTIME_EVENTS.DEVICE_COMMAND, commandPayload);
      console.log(`[RealDeviceService] Dispatched ${action} (id: ${commandId}) to device:${this.deviceId}`);
    });
  }

  /**
   * Handle incoming ACK from Raspberry Pi 5
   */
  handleCommandAck(ack: DeviceCommandAckPayload): void {
    const io = this.realtime?.io;
    const pending = this.pendingCommands.get(ack.commandId);

    const latencyMs = pending ? Date.now() - pending.startedAt : 0;
    const updatedAt = new Date().toISOString();

    const statusPayload: DeviceCommandStatusPayload = {
      commandId: ack.commandId,
      deviceId: ack.deviceId || this.deviceId,
      action: ack.action,
      status: ack.status,
      message: ack.message,
      latencyMs,
      result: ack.result,
      error: ack.error,
      updatedAt
    };

    if (io) {
      io.emit(REALTIME_EVENTS.DEVICE_COMMAND_STATUS, statusPayload);
    }

    if (!pending) {
      console.warn(`[RealDeviceService] Received ACK for unknown or expired command: ${ack.commandId}`);
      return;
    }

    clearTimeout(pending.timeoutTimer);
    this.pendingCommands.delete(ack.commandId);

    if (ack.status === 'COMPLETED') {
      pending.resolve({
        ...ack,
        latencyMs
      });
    } else {
      const err = new Error(ack.message || `Lệnh ${ack.action} thực thi thất bại trên thiết bị`);
      (err as any).code = ack.error || 'COMMAND_FAILED';
      (err as any).details = ack;
      pending.reject(err);
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
    this.isSocketConnected = false;
    this.sensors = null;
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timeoutTimer);
    }
    this.pendingCommands.clear();
  }
}

export const realDeviceService = new RealDeviceService();

