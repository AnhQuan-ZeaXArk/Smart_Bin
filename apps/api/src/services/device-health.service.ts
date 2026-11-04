import { AlertSeverity, AlertType, DeviceStatusEnum, DeviceType, type DeviceStatus } from '@prisma/client';
import { DEVICE_HEALTH_CONFIG } from '../config/device-health.config.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import type { RealtimeGateway } from '../integrations/realtime/realtime.gateway.js';

export interface DeviceHeartbeatInput {
  deviceId: string;
  deviceName?: string;
  deviceType?: DeviceType;
  status?: DeviceStatusEnum;
  ipAddress?: string | null;
  uptime?: number | null;
  uptimeSeconds?: number | null;
  cpuTempC?: number | null;
  firmwareVersion?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp?: string;
  sentAt?: string;
  sensors?: {
    distanceCm?: number | null;
    fillLevel?: number | null;
  } | null;
  receiveTimeOverride?: Date; // Dành riêng cho kịch bản kiểm thử mô phỏng thời gian nhận
}

export interface DeferredPromise {
  resolve: (device: DeviceStatus) => void;
  reject: (err: unknown) => void;
}

export interface PendingWriteState {
  input: DeviceHeartbeatInput;
  receiveTimestamp: Date; // Bảo toàn receive timestamp tương ứng của heartbeat đó
  deferreds: DeferredPromise[];
}

export interface DeviceHeartbeatState {
  lastHeartbeatTime: Date; // Thời điểm Backend thực sự tiếp nhận heartbeat gần nhất (receive timestamp)
  lastDbWriteTime: number; // Timestamp (ms) lần cuối ghi thành công vào Database
  lastKnownStatus: DeviceStatusEnum; // Trạng thái gần nhất được ghi nhận (ONLINE, WARNING, OFFLINE)
  isWritingDb: boolean; // Khóa Mutex chống nhiều tác vụ ghi DB chạy chồng chéo
  pendingWrite: PendingWriteState | null; // Bản ghi mới nhất chờ được drain tuần tự kèm receiveTimestamp
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
  public static readonly DB_WRITE_THROTTLE_MS = 15_000; // Throttle ghi DB tối đa 1 lần mỗi 15 giây
  private timer: NodeJS.Timeout | null = null;
  private heartbeatStates = new Map<string, DeviceHeartbeatState>();

  // Biến phục vụ kiểm toán và chứng minh Mutex hoạt động (TC-19, TC-20)
  public activeDbWritesCount: number = 0;
  public maxConcurrentDbWrites: number = 0;

  constructor(private realtime?: RealtimeGateway) {}

  setRealtime(realtime: RealtimeGateway): void {
    this.realtime = realtime;
  }

  getHeartbeatState(deviceId: string): DeviceHeartbeatState | undefined {
    return this.heartbeatStates.get(deviceId);
  }

  resetStates(): void {
    this.heartbeatStates.clear();
    this.activeDbWritesCount = 0;
    this.maxConcurrentDbWrites = 0;
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
    if (env.isDemoMode) {
      return [];
    }
    await this.evaluateAllDevices();
    return prisma.deviceStatus.findMany({
      orderBy: { createdAt: 'asc' }
    });
  }

  async getDeviceById(idOrDeviceId: string): Promise<DeviceStatus | null> {
    if (env.isDemoMode) {
      return null;
    }

    const device = await prisma.deviceStatus.findFirst({
      where: {
        OR: [{ id: idOrDeviceId }, { deviceId: idOrDeviceId }]
      }
    });
    if (!device) return null;

    const state = this.heartbeatStates.get(device.deviceId);
    const effectiveLastSeen = state?.lastHeartbeatTime || device.lastHeartbeat || device.lastSeen;
    const evaluatedStatus = computeDeviceStatus(effectiveLastSeen);
    if (evaluatedStatus !== device.status) {
      return this.updateDeviceStatus(device, evaluatedStatus);
    }
    return device;
  }

  /**
   * Xử lý gói tin Heartbeat định kỳ (Socket.IO hoặc HTTP) với cơ chế Database Write Throttling.
   * TUÂN THỦ NGUYÊN TẮC TIMESTAMP:
   * 1. Luôn sử dụng thời điểm Backend thực sự nhận heartbeat (`new Date()`) làm timestamp chuẩn.
   * 2. Không sử dụng `sentAt` hoặc `timestamp` do client Pi gửi để xác định ONLINE/OFFLINE.
   * 3. `sentAt` được lưu vào metadata để phục vụ đo độ trễ mạng nếu cần.
   */
  async processHeartbeat(input: DeviceHeartbeatInput): Promise<DeviceStatus | null> {
    if (env.isDemoMode) {
      // Trong Demo Mode: Tuyệt đối không gọi Prisma thật hoặc ghi PostgreSQL
      return null;
    }

    // Thời điểm Backend thực sự nhận heartbeat (chống lệch giờ Pi)
    const receiveTimestamp = input.receiveTimeOverride ? new Date(input.receiveTimeOverride) : new Date();

    let state = this.heartbeatStates.get(input.deviceId);
    if (!state) {
      state = {
        lastHeartbeatTime: receiveTimestamp,
        lastDbWriteTime: 0,
        lastKnownStatus: DeviceStatusEnum.OFFLINE,
        isWritingDb: false,
        pendingWrite: null
      };
      this.heartbeatStates.set(input.deviceId, state);
    }

    // Luôn cập nhật thời điểm nhận heartbeat mới nhất vào RAM theo giờ Backend
    state.lastHeartbeatTime = receiveTimestamp;

    const elapsedSinceLastDbWrite = receiveTimestamp.getTime() - state.lastDbWriteTime;
    const isFirstWrite = state.lastDbWriteTime === 0;
    const isStateChanged = state.lastKnownStatus !== DeviceStatusEnum.ONLINE;
    const shouldWriteDb = isFirstWrite || isStateChanged || elapsedSinceLastDbWrite >= DeviceHealthService.DB_WRITE_THROTTLE_MS;

    if (shouldWriteDb) {
      return this.executeDbUpsert(input, receiveTimestamp, state);
    }

    // Đang trong khoảng throttle (< 15s): Bỏ qua ghi DB để bảo vệ cơ sở dữ liệu
    return null;
  }

  /**
   * Ghi trực tiếp hoặc cập nhật bản ghi DeviceStatus vào PostgreSQL sử dụng atomic upsert.
   * Luôn sử dụng receive timestamp của Backend.
   */
  async recordHeartbeat(input: DeviceHeartbeatInput): Promise<DeviceStatus> {
    if (env.isDemoMode) {
      // Demo mock fallback
      return {
        id: `demo-${input.deviceId}`,
        deviceId: input.deviceId,
        deviceName: input.deviceName ?? input.deviceId,
        deviceType: input.deviceType ?? DeviceType.RASPBERRY_PI,
        status: DeviceStatusEnum.ONLINE,
        lastSeen: new Date(),
        lastHeartbeat: new Date(),
        firmwareVersion: input.firmwareVersion ?? null,
        ipAddress: input.ipAddress ?? null,
        uptime: input.uptimeSeconds ?? input.uptime ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }

    const receiveTimestamp = input.receiveTimeOverride ? new Date(input.receiveTimeOverride) : new Date();
    let state = this.heartbeatStates.get(input.deviceId);
    if (!state) {
      state = {
        lastHeartbeatTime: receiveTimestamp,
        lastDbWriteTime: 0,
        lastKnownStatus: DeviceStatusEnum.OFFLINE,
        isWritingDb: false,
        pendingWrite: null
      };
      this.heartbeatStates.set(input.deviceId, state);
    }
    state.lastHeartbeatTime = receiveTimestamp;

    return this.executeDbUpsert(input, receiveTimestamp, state);
  }

  /**
   * Thực thi Atomic Upsert vào PostgreSQL với khóa Mutex nghiêm ngặt và xử lý tuần tự Pending Write.
   * ĐẢM BẢO:
   * 1. Mỗi deviceId chỉ có duy nhất tối đa 1 tác vụ ghi DB chạy tại một thời điểm.
   * 2. Nếu đang có tác vụ chạy, chỉ cập nhật pendingWrite với heartbeat mới nhất và receiveTimestamp của nó.
   * 3. Không dùng findUnique để quyết định tiếp tục ghi DB.
   * 4. Khi drain pending write, bảo toàn đúng receiveTimestamp tương ứng.
   * 5. Khóa Mutex luôn được giải phóng trong finally block; không bao giờ bị khóa vĩnh viễn.
   */
  private executeDbUpsert(
    input: DeviceHeartbeatInput,
    receiveTimestamp: Date,
    state: DeviceHeartbeatState
  ): Promise<DeviceStatus> {
    // 1. Kiểm tra khóa Mutex
    if (state.isWritingDb) {
      // Đang có một tác vụ ghi DB đang thực thi cho deviceId này.
      // Dừng lại ngay lập tức, chỉ cập nhật pending write bằng heartbeat mới nhất và receiveTimestamp của nó.
      return new Promise<DeviceStatus>((resolve, reject) => {
        if (!state.pendingWrite) {
          state.pendingWrite = {
            input,
            receiveTimestamp,
            deferreds: [{ resolve, reject }]
          };
        } else {
          // Ghi đè bằng dữ liệu heartbeat mới nhất và giữ receiveTimestamp của heartbeat mới
          state.pendingWrite.input = input;
          state.pendingWrite.receiveTimestamp = receiveTimestamp;
          state.pendingWrite.deferreds.push({ resolve, reject });
        }
      });
    }

    // 2. Kích hoạt khóa Mutex
    state.isWritingDb = true;
    this.activeDbWritesCount++;
    if (this.activeDbWritesCount > this.maxConcurrentDbWrites) {
      this.maxConcurrentDbWrites = this.activeDbWritesCount;
    }

    return (async () => {
      try {
        const uptime = input.uptimeSeconds ?? input.uptime ?? null;
        const combinedMetadata: Record<string, unknown> = {
          ...(input.metadata || {})
        };
        if (input.cpuTempC !== undefined && input.cpuTempC !== null) {
          combinedMetadata.cpuTempC = input.cpuTempC;
        }
        if (input.sensors !== undefined && input.sensors !== null) {
          combinedMetadata.sensors = input.sensors;
        }
        // Lưu `sentAt` vào metadata để phục vụ đo độ trễ mạng nếu cần, tuyệt đối không dùng để tính ONLINE/OFFLINE
        if (input.sentAt) {
          combinedMetadata.sentAt = input.sentAt;
        }
        const metadataStr = Object.keys(combinedMetadata).length > 0 ? JSON.stringify(combinedMetadata) : null;

        const previousStatus = state.lastKnownStatus;
        const wasOffline = previousStatus === DeviceStatusEnum.OFFLINE;

        // Sử dụng Prisma atomic upsert theo unique deviceId (chống trùng lặp và race condition)
        // Dùng receiveTimestamp của Backend làm thời điểm lastSeen và lastHeartbeat chuẩn
        const device = await prisma.deviceStatus.upsert({
          where: { deviceId: input.deviceId },
          create: {
            deviceId: input.deviceId,
            deviceName: input.deviceName ?? input.deviceId,
            deviceType: input.deviceType ?? DeviceType.RASPBERRY_PI,
            status: DeviceStatusEnum.ONLINE,
            lastSeen: receiveTimestamp,
            lastHeartbeat: receiveTimestamp,
            ipAddress: input.ipAddress ?? null,
            uptime,
            firmwareVersion: input.firmwareVersion ?? null,
            metadata: metadataStr
          },
          update: {
            status: DeviceStatusEnum.ONLINE,
            lastSeen: receiveTimestamp,
            lastHeartbeat: receiveTimestamp,
            ...(input.deviceName ? { deviceName: input.deviceName } : {}),
            ...(input.deviceType ? { deviceType: input.deviceType } : {}),
            ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
            ...(uptime !== null ? { uptime } : {}),
            ...(input.firmwareVersion !== undefined ? { firmwareVersion: input.firmwareVersion } : {}),
            ...(metadataStr !== null ? { metadata: metadataStr } : {})
          }
        });

        state.lastDbWriteTime = Date.now();
        state.lastKnownStatus = DeviceStatusEnum.ONLINE;

        // Nếu thiết bị trước đó là OFFLINE, tự động resolve cảnh báo OFFLINE của đúng thiết bị này
        if (wasOffline) {
          await this.resolveDeviceAlert(device.deviceName, device.deviceId);
        }

        this.realtime?.emitDeviceStatus(device);
        return device;
      } catch (error) {
        console.error(`[DeviceHealthService FATAL] Lỗi ghi Database cho thiết bị ${input.deviceId}:`, error);
        // Lỗi ghi DB: Không cập nhật lastDbWriteTime để heartbeat tiếp theo tự động retry
        throw error;
      } finally {
        this.activeDbWritesCount--;
        state.isWritingDb = false;

        // Xử lý tuần tự Pending Write nếu có
        if (state.pendingWrite) {
          const { input: nextInput, receiveTimestamp: nextTimestamp, deferreds } = state.pendingWrite;
          state.pendingWrite = null;

          // Thực thi tuần tự pending write với đúng receiveTimestamp bảo toàn của nó
          this.executeDbUpsert(nextInput, nextTimestamp, state)
            .then((result) => {
              for (const d of deferreds) d.resolve(result);
            })
            .catch((drainError) => {
              console.error(`[DeviceHealthService] Lỗi khi xử lý drained pending write cho ${nextInput.deviceId}:`, drainError);
              for (const d of deferreds) d.reject(drainError);
            });
        }
      }
    })();
  }

  async recordDeviceActivity(
    deviceId: string,
    defaultType: DeviceType,
    defaultName: string,
    metadata?: Record<string, unknown>
  ): Promise<DeviceStatus> {
    if (env.isDemoMode) {
      return this.recordHeartbeat({ deviceId, deviceName: defaultName, deviceType: defaultType, metadata });
    }

    const now = new Date();
    const metadataStr = metadata ? JSON.stringify(metadata) : null;

    const device = await prisma.deviceStatus.upsert({
      where: { deviceId },
      create: {
        deviceId,
        deviceName: defaultName,
        deviceType: defaultType,
        status: DeviceStatusEnum.ONLINE,
        lastSeen: now,
        lastHeartbeat: now,
        metadata: metadataStr
      },
      update: {
        status: DeviceStatusEnum.ONLINE,
        lastSeen: now,
        ...(metadataStr ? { metadata: metadataStr } : {})
      }
    });

    const state = this.heartbeatStates.get(deviceId);
    if (state) {
      if (state.lastKnownStatus === DeviceStatusEnum.OFFLINE) {
        await this.resolveDeviceAlert(device.deviceName, device.deviceId);
      }
      state.lastHeartbeatTime = now;
      state.lastKnownStatus = DeviceStatusEnum.ONLINE;
      state.lastDbWriteTime = now.getTime();
    }

    this.realtime?.emitDeviceStatus(device);
    return device;
  }

  async setDeviceStatus(deviceId: string, status: DeviceStatusEnum, metadata?: Record<string, unknown>): Promise<DeviceStatus | null> {
    if (env.isDemoMode) {
      return null;
    }

    const existing = await prisma.deviceStatus.findUnique({
      where: { deviceId }
    });
    if (!existing) return null;

    const previousStatus = existing.status;
    const now = new Date();
    const metadataStr = metadata ? JSON.stringify(metadata) : existing.metadata;

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

    const state = this.heartbeatStates.get(deviceId);
    if (state) {
      state.lastKnownStatus = status;
    }

    if (previousStatus !== status) {
      if (status === DeviceStatusEnum.OFFLINE) {
        await this.createDeviceAlert(updated.deviceName, updated.deviceId);
      } else if (status === DeviceStatusEnum.ONLINE) {
        await this.resolveDeviceAlert(updated.deviceName, updated.deviceId);
      }
    }

    this.realtime?.emitDeviceStatus(updated);
    return updated;
  }

  async evaluateAllDevices(): Promise<void> {
    if (env.isDemoMode) return;

    const devices = await prisma.deviceStatus.findMany();
    const now = new Date();

    for (const device of devices) {
      if (device.deviceType === DeviceType.MQTT) continue;

      const state = this.heartbeatStates.get(device.deviceId);
      // Ưu tiên thời điểm nhận heartbeat thực tế trong RAM (receive timestamp), sau đó fallback vào lastHeartbeat hoặc lastSeen trong DB
      const effectiveLastSeen = state?.lastHeartbeatTime || device.lastHeartbeat || device.lastSeen;

      const newStatus = computeDeviceStatus(effectiveLastSeen, now);
      if (newStatus !== device.status) {
        await this.updateDeviceStatus(device, newStatus);
        if (state) {
          state.lastKnownStatus = newStatus;
        }
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
        await this.createDeviceAlert(device.deviceName, device.deviceId);
      } else if (newStatus === DeviceStatusEnum.ONLINE && previousStatus === DeviceStatusEnum.OFFLINE) {
        await this.resolveDeviceAlert(device.deviceName, device.deviceId);
      }
      this.realtime?.emitDeviceStatus(updated);
    }

    return updated;
  }

  /**
   * Tạo cảnh báo DEVICE_OFFLINE được gán nhãn mã thiết bị duy nhất [deviceId] để chống va chạm tên
   */
  private async createDeviceAlert(deviceName: string, deviceId: string): Promise<void> {
    const deviceTag = `[${deviceId}]`;
    const existing = await prisma.alert.findFirst({
      where: {
        type: AlertType.DEVICE_OFFLINE,
        isResolved: false,
        message: { contains: deviceTag }
      }
    });

    if (!existing) {
      const alert = await prisma.alert.create({
        data: {
          type: AlertType.DEVICE_OFFLINE,
          severity: AlertSeverity.CRITICAL,
          message: `Thiết bị ${deviceName} [${deviceId}] mất kết nối (không nhận dữ liệu trong ${DEVICE_HEALTH_CONFIG.OFFLINE_THRESHOLD_MS / 1000} giây).`
        }
      });
      this.realtime?.emitAlert(alert);
    }
  }

  /**
   * Resolve chính xác cảnh báo của thiết bị dựa trên mã deviceId duy nhất, không giải quyết nhầm thiết bị khác
   */
  private async resolveDeviceAlert(deviceName: string, deviceId: string): Promise<void> {
    const deviceTag = `[${deviceId}]`;
    const alertsToResolve = await prisma.alert.findMany({
      where: {
        type: AlertType.DEVICE_OFFLINE,
        isResolved: false,
        OR: [
          { message: { contains: deviceTag } },
          { message: { contains: `(${deviceId})` } }
        ]
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
