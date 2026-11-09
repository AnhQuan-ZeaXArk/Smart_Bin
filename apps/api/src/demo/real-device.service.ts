import type { RealtimeGateway } from '../integrations/realtime/realtime.gateway.js';
import { DEVICE_HEALTH_CONFIG } from '../config/device-health.config.js';
import {
  REALTIME_EVENTS,
  type DeviceCommandAckPayload,
  type DeviceCommandPayload,
  type DeviceCommandStatusPayload,
  type MultiCompartmentSensorsData,
  type SubsystemStatus,
  type AiDetectionResult
} from '../integrations/realtime/realtime.contract.js';

export type DeviceSensorsData = MultiCompartmentSensorsData;

export interface HeartbeatPayload {
  deviceId: string;
  status?: string;
  uptimeSeconds: number;
  cpuTempC?: number | null;
  sentAt?: string;
  subsystems?: SubsystemStatus | null;
  aiDetection?: AiDetectionResult | null;
  sensors?: MultiCompartmentSensorsData | null;
  metadata?: Record<string, unknown> | null;
}

export type RealDeviceStatusType = 'ONLINE' | 'WARNING' | 'OFFLINE' | 'STALE';

export interface RealDeviceStatus {
  deviceId: string;
  deviceName: string;
  deviceType: 'RASPBERRY_PI';
  stationCode?: string;
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
  subsystems: SubsystemStatus;
  aiDetection: AiDetectionResult | null;
  detectionHistory: AiDetectionResult[];
  sensors?: MultiCompartmentSensorsData | null;
  metadata?: {
    onlineThresholdSeconds?: number;
    warningThresholdSeconds?: number;
    staleThresholdSeconds: number;
    offlineThresholdSeconds: number;
    platform?: string;
    detectionCount?: number;
    lastInferenceMs?: number | null;
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
  private previousSocketConnected: boolean = false;
  private isSocketConnected: boolean = false;
  private sensors: DeviceSensorsData | null = null;
  private subsystems: SubsystemStatus = {
    yolo: 'STOPPED',
    camera: 'DISCONNECTED',
    esp32: 'DISCONNECTED'
  };
  private aiDetection: AiDetectionResult | null = null;
  private detectionHistory: AiDetectionResult[] = [];

  // Active command pending registry
  private pendingCommands = new Map<string, PendingCommand>();

  // Đồng bộ cấu hình ngưỡng thời gian với DEVICE_HEALTH_CONFIG
  public readonly ONLINE_THRESHOLD_MS = DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS;
  public readonly WARNING_THRESHOLD_MS = DEVICE_HEALTH_CONFIG.WARNING_THRESHOLD_MS;
  public readonly OFFLINE_THRESHOLD_MS = DEVICE_HEALTH_CONFIG.OFFLINE_THRESHOLD_MS;
  public readonly ONLINE_THRESHOLD_SECONDS = DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_SECONDS;
  public readonly WARNING_THRESHOLD_SECONDS = DEVICE_HEALTH_CONFIG.WARNING_THRESHOLD_SECONDS;
  public readonly STALE_THRESHOLD_SECONDS = DEVICE_HEALTH_CONFIG.STALE_THRESHOLD_SECONDS;
  public readonly OFFLINE_THRESHOLD_SECONDS = DEVICE_HEALTH_CONFIG.OFFLINE_THRESHOLD_SECONDS;
  private readonly CHECK_INTERVAL_MS = DEVICE_HEALTH_CONFIG.CHECK_INTERVAL_MS;

  setRealtime(realtime: RealtimeGateway): void {
    this.realtime = realtime;
  }

  setSocketConnected(deviceId: string, connected: boolean): void {
    if (this.deviceId === deviceId || !this.deviceId) {
      this.isSocketConnected = connected;
      // QUY TẮC AN TOÀN: Kết nối Socket.IO thành công KHÔNG ĐƯỢC tự động đánh dấu ONLINE
      // hoặc cập nhật lastHeartbeatDate/lastReceivedAt. Socket.IO Connected và Device ONLINE là 2 trạng thái độc lập.
      this.evaluateStatusChange();
    }
  }

  setLastHeartbeatDateForTest(date: Date | null): void {
    this.lastHeartbeatDate = date;
    if (date) {
      this.lastReceivedAt = date.toISOString();
      this.heartbeatCount = Math.max(1, this.heartbeatCount);
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

    if (input.subsystems) {
      this.subsystems = {
        ...this.subsystems,
        ...input.subsystems
      };
    }

    if (input.aiDetection) {
      this.aiDetection = input.aiDetection;
      // Lưu trữ 10 kết quả nhận diện gần nhất
      this.detectionHistory.unshift(input.aiDetection);
      if (this.detectionHistory.length > 10) {
        this.detectionHistory = this.detectionHistory.slice(0, 10);
      }
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

  getStatus(nowOverride?: number): RealDeviceStatus {
    const now = nowOverride ?? Date.now();
    let computedStatus: RealDeviceStatusType = 'OFFLINE';
    let ageSeconds: number | null = null;

    if (this.lastHeartbeatDate) {
      const elapsedMs = now - this.lastHeartbeatDate.getTime();
      ageSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
      if (elapsedMs < DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS) {
        computedStatus = 'ONLINE';
      } else if (elapsedMs < DEVICE_HEALTH_CONFIG.WARNING_THRESHOLD_MS) {
        computedStatus = 'WARNING';
      } else {
        computedStatus = 'OFFLINE';
      }
    }

    return {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      deviceType: 'RASPBERRY_PI',
      stationCode: 'STATION_A',
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
      subsystems: this.subsystems,
      aiDetection: this.aiDetection,
      detectionHistory: this.detectionHistory,
      sensors: this.sensors,
      metadata: {
        onlineThresholdSeconds: DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_SECONDS,
        warningThresholdSeconds: DEVICE_HEALTH_CONFIG.WARNING_THRESHOLD_SECONDS,
        staleThresholdSeconds: DEVICE_HEALTH_CONFIG.STALE_THRESHOLD_SECONDS,
        offlineThresholdSeconds: DEVICE_HEALTH_CONFIG.OFFLINE_THRESHOLD_SECONDS,
        platform: 'Raspberry Pi 5'
      }
    };
  }

  private evaluateStatusChange(): void {
    const currentStatusObj = this.getStatus();
    const hasStatusChanged = currentStatusObj.status !== this.previousStatus;
    const hasSocketChanged = currentStatusObj.isSocketConnected !== this.previousSocketConnected;

    if (hasStatusChanged || hasSocketChanged) {
      this.previousStatus = currentStatusObj.status;
      this.previousSocketConnected = currentStatusObj.isSocketConnected;
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
    this.previousSocketConnected = false;
    this.isSocketConnected = false;
    this.sensors = null;
    this.subsystems = {
      yolo: 'STOPPED',
      camera: 'DISCONNECTED',
      esp32: 'DISCONNECTED'
    };
    this.aiDetection = null;
    this.detectionHistory = [];
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timeoutTimer);
    }
    this.pendingCommands.clear();
  }
}

export const realDeviceService = new RealDeviceService();

