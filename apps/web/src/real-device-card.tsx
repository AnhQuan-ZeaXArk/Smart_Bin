import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRealtime } from './realtime-store';
import { useAuth } from './auth-context';
import { apiUrl } from './api-config';
import {
  IconCpu,
  IconCheckCircle,
  IconAlertTriangle,
  IconXCircle,
  IconRefresh,
  IconInfo,
  IconRadio,
  IconActivity,
  IconCamera
} from './icons';
import {
  type DeviceStatusEnum,
  formatDateTime,
  formatUptime,
  parseTimestamp,
  shouldDropIncoming,
  CANONICAL_PI_DEVICE_ID,
  isRaspberryPiDevice
} from './device-utils';
import { formatConfidence } from './ai-confidence';

export interface CompartmentFillData {
  distanceCm?: number | null;
  fillLevel?: number | null;
  status?: string;
  updatedAt?: string | null;
}

export interface DeviceSensorsData {
  distanceCm?: number | null;
  fillLevel?: number | null;
  organic?: CompartmentFillData | null;
  recyclable?: CompartmentFillData | null;
  nonRecyclable?: CompartmentFillData | null;
}

export interface SubsystemStatus {
  yolo?: string;
  camera?: string;
  esp32?: string;
}

export interface AiDetectionResult {
  class: string;
  rawClass?: string;
  confidence: number;
  inferenceTimeMs?: number | null;
  timestamp: string;
}

export interface RealDeviceData {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  isReal: boolean;
  status: DeviceStatusEnum;
  uptimeSeconds: number | null;
  cpuTempC: number | null;
  lastHeartbeat: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  heartbeatCount: number;
  ageSeconds: number | null;
  firmwareVersion?: string | null;
  ipAddress?: string | null;
  isSocketConnected?: boolean;
  subsystems?: SubsystemStatus | null;
  aiDetection?: AiDetectionResult | null;
  detectionHistory?: AiDetectionResult[];
  sensors?: DeviceSensorsData | null;
  metadata?: {
    onlineThresholdSeconds?: number;
    warningThresholdSeconds?: number;
    offlineThresholdSeconds?: number;
    staleThresholdSeconds?: number;
    platform?: string;
    detectionCount?: number;
    lastInferenceMs?: number | null;
  };
}

interface CommandExecutionState {
  status: 'IDLE' | 'PENDING' | 'RECEIVED' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  action: 'PING' | 'TRIGGER_ULTRASONIC' | null;
  latencyMs?: number;
  message?: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
  updatedAt?: number;
}

interface RealDeviceCardProps {
  /** Optional compact styling */
  compact?: boolean;
  /** External trigger to refresh card (e.g. from page header refresh button) */
  refreshTrigger?: number | string;
}

export function RealDeviceCard({ compact = false, refreshTrigger }: RealDeviceCardProps) {
  const { socket, connected: realtimeConnected } = useRealtime();
  const { token, user, systemMode } = useAuth();
  const canExecuteCommands = systemMode === 'demo' || user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';
  const [data, setData] = useState<RealDeviceData | null>(null);
  const [receivedAtLocalMs, setReceivedAtLocalMs] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Timestamp guard using ref to avoid unsafe state updater side-effects
  const latestHeartbeatTsRef = useRef<number>(0);

  // Trạng thái thực thi lệnh điều khiển hai chiều
  const [commandState, setCommandState] = useState<CommandExecutionState>({
    status: 'IDLE',
    action: null
  });

  // Update clock every second for live age calculation
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initial fetch and trigger on external refresh
  useEffect(() => {
    let active = true;
    const fetchUrl = `${apiUrl}/api/demo/device-status?_t=${Date.now()}`;
    fetch(fetchUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: Không thể tải trạng thái thiết bị thực.`);
        }
        return res.json();
      })
      .then((json) => {
        if (!active || !json.success || !json.data) return;
        const restTs = parseTimestamp(json.data.lastHeartbeat || json.data.receivedAt);
        const currentTs = latestHeartbeatTsRef.current;

        // Xử lý REST Race Condition: Nếu Socket đã nhận dữ liệu mới hơn, bỏ qua REST data cũ
        if (shouldDropIncoming(currentTs, restTs)) {
          return;
        }

        if (restTs > 0) {
          latestHeartbeatTsRef.current = Math.max(currentTs, restTs);
        }

        setData((prev) => {
          if (!prev) return json.data;
          const newUptime = typeof json.data.uptimeSeconds === 'number'
            ? json.data.uptimeSeconds
            : typeof (json.data as any).uptime === 'number'
            ? (json.data as any).uptime
            : prev.uptimeSeconds;
          const newCpu = typeof json.data.cpuTempC === 'number'
            ? json.data.cpuTempC
            : prev.cpuTempC;
          const newSensors = json.data.sensors !== undefined && json.data.sensors !== null
            ? json.data.sensors
            : prev.sensors;

          return {
            ...prev,
            ...json.data,
            uptimeSeconds: newUptime,
            cpuTempC: newCpu,
            sensors: newSensors,
            subsystems: json.data.subsystems ?? prev.subsystems,
            aiDetection: json.data.aiDetection ?? prev.aiDetection,
            detectionHistory: json.data.detectionHistory ?? prev.detectionHistory,
            firmwareVersion: json.data.firmwareVersion ?? prev.firmwareVersion,
            ipAddress: json.data.ipAddress ?? prev.ipAddress
          };
        });
        setReceivedAtLocalMs(Date.now());
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Lỗi kết nối API thiết bị');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshTrigger]);

  // Manual refresh handler
  const handleManualRefresh = useCallback(() => {
    setRefreshing(true);
    const fetchUrl = `${apiUrl}/api/demo/device-status?_t=${Date.now()}`;
    fetch(fetchUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: Không thể tải trạng thái thiết bị thực.`);
        }
        return res.json();
      })
      .then((json) => {
        if (!json.success || !json.data) return;
        const restTs = parseTimestamp(json.data.lastHeartbeat || json.data.receivedAt);
        const currentTs = latestHeartbeatTsRef.current;

        // Xử lý REST Race Condition: Nếu Socket đã nhận dữ liệu mới hơn, bỏ qua REST data cũ
        if (shouldDropIncoming(currentTs, restTs)) {
          return;
        }

        if (restTs > 0) {
          latestHeartbeatTsRef.current = Math.max(currentTs, restTs);
        }

        setData((prev) => {
          if (!prev) return json.data;
          const newUptime = typeof json.data.uptimeSeconds === 'number'
            ? json.data.uptimeSeconds
            : typeof (json.data as any).uptime === 'number'
            ? (json.data as any).uptime
            : prev.uptimeSeconds;
          const newCpu = typeof json.data.cpuTempC === 'number'
            ? json.data.cpuTempC
            : prev.cpuTempC;
          const newSensors = json.data.sensors !== undefined && json.data.sensors !== null
            ? json.data.sensors
            : prev.sensors;

          return {
            ...prev,
            ...json.data,
            uptimeSeconds: newUptime,
            cpuTempC: newCpu,
            sensors: newSensors,
            subsystems: json.data.subsystems ?? prev.subsystems,
            aiDetection: json.data.aiDetection ?? prev.aiDetection,
            detectionHistory: json.data.detectionHistory ?? prev.detectionHistory,
            firmwareVersion: json.data.firmwareVersion ?? prev.firmwareVersion,
            ipAddress: json.data.ipAddress ?? prev.ipAddress
          };
        });
        setReceivedAtLocalMs(Date.now());
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Lỗi kết nối API thiết bị');
      })
      .finally(() => {
        setRefreshing(false);
      });
  }, []);

  // Realtime Socket.IO listeners: device:heartbeat, device:command:status, and reconnection sync
  useEffect(() => {
    if (!socket) return;

    const handleHeartbeat = (payload: RealDeviceData) => {
      if (!payload) return;
      if (!isRaspberryPiDevice(payload.deviceId, (payload as any).deviceType)) return;
      const incomingTs = parseTimestamp(payload.lastHeartbeat || payload.receivedAt || payload.sentAt);
      const currentTs = latestHeartbeatTsRef.current;

      // Chống sự kiện cũ hoặc sự kiện không có timestamp khi đã có timestamp hợp lệ
      if (shouldDropIncoming(currentTs, incomingTs)) {
        return;
      }
      if (incomingTs > 0) {
        latestHeartbeatTsRef.current = Math.max(currentTs, incomingTs);
      }

      setData((prev) => {
        if (!prev) return { ...payload, deviceId: CANONICAL_PI_DEVICE_ID };
        const newUptime = typeof payload.uptimeSeconds === 'number'
          ? payload.uptimeSeconds
          : typeof (payload as any).uptime === 'number'
          ? (payload as any).uptime
          : prev.uptimeSeconds;
        const newCpu = typeof payload.cpuTempC === 'number'
          ? payload.cpuTempC
          : prev.cpuTempC;
        const newSensors = payload.sensors !== undefined && payload.sensors !== null
          ? payload.sensors
          : prev.sensors;

        return {
          ...prev,
          ...payload,
          deviceId: CANONICAL_PI_DEVICE_ID,
          uptimeSeconds: newUptime,
          cpuTempC: newCpu,
          sensors: newSensors,
          subsystems: payload.subsystems ?? prev.subsystems,
          aiDetection: payload.aiDetection ?? prev.aiDetection,
          detectionHistory: payload.detectionHistory ?? prev.detectionHistory,
          firmwareVersion: payload.firmwareVersion ?? prev.firmwareVersion,
          ipAddress: payload.ipAddress ?? prev.ipAddress
        };
      });

      setReceivedAtLocalMs(Date.now());
      setError(null);
      // Trigger heartbeat animation pulse
      setPulse(true);
      setTimeout(() => setPulse(false), 1200);
    };

    const handleCommandStatus = (statusPayload: any) => {
      setCommandState({
        status: statusPayload.status,
        action: statusPayload.action,
        latencyMs: statusPayload.latencyMs,
        message: statusPayload.message,
        result: statusPayload.result,
        error: statusPayload.error,
        updatedAt: Date.now()
      });

      if (statusPayload.status === 'COMPLETED') {
        setPulse(true);
        setTimeout(() => setPulse(false), 1200);
      }
    };

    const handleReconnect = () => {
      handleManualRefresh();
    };

    const handleDeviceStatus = (payload: any) => {
      if (!payload) return;
      if (!isRaspberryPiDevice(payload.deviceId, payload.deviceType)) return;

      const incomingTs = parseTimestamp(payload.lastHeartbeat || payload.lastSeen);
      const currentTs = latestHeartbeatTsRef.current;

      // Chống sự kiện cũ hoặc sự kiện không có timestamp khi đã có timestamp hợp lệ
      if (shouldDropIncoming(currentTs, incomingTs)) {
        return;
      }
      if (incomingTs > 0) {
        latestHeartbeatTsRef.current = Math.max(currentTs, incomingTs);
      }

      setData((prev) => {
        if (!prev) return prev;
        const newUptime = typeof payload.uptimeSeconds === 'number'
          ? payload.uptimeSeconds
          : typeof payload.uptime === 'number'
          ? payload.uptime
          : prev.uptimeSeconds;
        return {
          ...prev,
          deviceId: CANONICAL_PI_DEVICE_ID,
          status: payload.status || prev.status,
          lastHeartbeat: payload.lastHeartbeat || prev.lastHeartbeat,
          uptimeSeconds: newUptime,
          firmwareVersion: payload.firmwareVersion || prev.firmwareVersion,
          ipAddress: payload.ipAddress || prev.ipAddress
        };
      });
    };

    socket.on('device:heartbeat', handleHeartbeat);
    socket.on('device:status', handleDeviceStatus);
    socket.on('device:command:status', handleCommandStatus);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('device:heartbeat', handleHeartbeat);
      socket.off('device:status', handleDeviceStatus);
      socket.off('device:command:status', handleCommandStatus);
      socket.off('connect', handleReconnect);
    };
  }, [socket, handleManualRefresh]);

  // Tính thời gian đã trôi qua từ lần heartbeat gần nhất (để hiển thị Last Heartbeat Age)
  // Backend là nguồn trạng thái chuẩn duy nhất (data.status: ONLINE / WARNING / OFFLINE)
  const { liveAgeSeconds, liveStatus } = useMemo(() => {
    if (!data || !data.lastHeartbeat || data.heartbeatCount === 0) {
      return { liveAgeSeconds: null, liveStatus: 'OFFLINE' as DeviceStatusEnum };
    }

    // Elapsed seconds trên trình duyệt kể từ gói telemetry gần nhất
    const elapsedSinceReceive = Math.max(0, Math.floor((now - receivedAtLocalMs) / 1000));

    // Base age do Backend báo cáo tại thời điểm nhận + elapsed seconds trên client
    const serverBaseAge = typeof data.ageSeconds === 'number' && !isNaN(data.ageSeconds) ? data.ageSeconds : 0;
    const effectiveAge = serverBaseAge + elapsedSinceReceive;

    // Sử dụng trực tiếp status do Backend cung cấp, không tự tính lại bằng timeout trên Frontend
    const currentStatus: DeviceStatusEnum = data.status || 'OFFLINE';

    return { liveAgeSeconds: effectiveAge, liveStatus: currentStatus };
  }, [data, receivedAtLocalMs, now]);

  function renderAgeText(seconds: number | null) {
    if (seconds === null) return 'Chưa nhận heartbeat';
    if (seconds === 0) return 'Vừa nhận ngay tức thì';
    if (seconds < 60) return `${seconds} giây trước`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return `${m} phút ${s > 0 ? `${s}s` : ''} trước`;
    const h = Math.floor(m / 60);
    return `${h} giờ trước`;
  }

  // Gửi lệnh PING an toàn tới Raspberry Pi 5
  const handleSendPing = async () => {
    if (liveStatus === 'OFFLINE' || commandState.status === 'PENDING') return;

    if (!canExecuteCommands) {
      setCommandState({
        status: 'FAILED',
        action: 'PING',
        message: 'Từ chối quyền: Cần đăng nhập tài khoản Quản trị viên hoặc Giám sát viên để gửi lệnh điều khiển tới thiết bị.',
        updatedAt: Date.now()
      });
      return;
    }

    setCommandState({
      status: 'PENDING',
      action: 'PING',
      message: 'Đang gửi lệnh PING tới Raspberry Pi 5...',
      updatedAt: Date.now()
    });

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${apiUrl}/api/demo/device-command`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          deviceId: CANONICAL_PI_DEVICE_ID,
          action: 'PING'
        })
      });

      const json = await res.json();
      if (!res.ok) {
        let msg = json.message || 'Lệnh PING thất bại';
        if (res.status === 401) {
          msg = 'Phiên làm việc hết hạn hoặc chưa đăng nhập (401). Vui lòng đăng nhập lại.';
        } else if (res.status === 403) {
          msg = 'Từ chối quyền (403): Chỉ Quản trị viên và Giám sát viên mới có quyền gửi lệnh.';
        }
        setCommandState({
          status: json.error === 'COMMAND_TIMEOUT' ? 'TIMEOUT' : 'FAILED',
          action: 'PING',
          message: msg,
          error: json.error,
          updatedAt: Date.now()
        });
      } else {
        setCommandState({
          status: 'COMPLETED',
          action: 'PING',
          message: json.message || 'Pong! Raspberry Pi 5 đã phản hồi thành công.',
          latencyMs: json.latencyMs,
          result: json.result,
          updatedAt: Date.now()
        });
        setPulse(true);
        setTimeout(() => setPulse(false), 1200);
      }
    } catch (err) {
      setCommandState({
        status: 'FAILED',
        action: 'PING',
        message: err instanceof Error ? err.message : 'Lỗi kết nối khi gửi lệnh PING',
        updatedAt: Date.now()
      });
    }
  };

  // Gửi lệnh đo siêu âm (TRIGGER_ULTRASONIC)
  const handleTriggerUltrasonic = async () => {
    if (liveStatus === 'OFFLINE' || commandState.status === 'PENDING') return;

    if (!canExecuteCommands) {
      setCommandState({
        status: 'FAILED',
        action: 'TRIGGER_ULTRASONIC',
        message: 'Từ chối quyền: Cần đăng nhập tài khoản Quản trị viên hoặc Giám sát viên để gửi lệnh tới thiết bị.',
        updatedAt: Date.now()
      });
      return;
    }

    setCommandState({
      status: 'PENDING',
      action: 'TRIGGER_ULTRASONIC',
      message: 'Đang gửi yêu cầu đo cảm biến siêu âm tới Pi 5...',
      updatedAt: Date.now()
    });

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${apiUrl}/api/demo/device-command`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          deviceId: CANONICAL_PI_DEVICE_ID,
          action: 'TRIGGER_ULTRASONIC'
        })
      });

      const json = await res.json();
      if (!res.ok) {
        let msg = json.message || 'Cảm biến chưa sẵn sàng hoặc chưa kết nối chân GPIO vật lý.';
        if (res.status === 401) {
          msg = 'Phiên làm việc hết hạn hoặc chưa đăng nhập (401). Vui lòng đăng nhập lại.';
        } else if (res.status === 403) {
          msg = 'Từ chối quyền (403): Chỉ Quản trị viên và Giám sát viên mới có quyền gửi lệnh.';
        }
        setCommandState({
          status: json.error === 'COMMAND_TIMEOUT' ? 'TIMEOUT' : 'FAILED',
          action: 'TRIGGER_ULTRASONIC',
          message: msg,
          error: json.error,
          updatedAt: Date.now()
        });
      } else {
        setCommandState({
          status: 'COMPLETED',
          action: 'TRIGGER_ULTRASONIC',
          message: json.message || 'Đo cảm biến siêu âm thành công.',
          latencyMs: json.latencyMs,
          result: json.result,
          updatedAt: Date.now()
        });
      }
    } catch (err) {
      setCommandState({
        status: 'FAILED',
        action: 'TRIGGER_ULTRASONIC',
        message: err instanceof Error ? err.message : 'Lỗi kết nối khi gửi lệnh đo siêu âm',
        updatedAt: Date.now()
      });
    }
  };

  const statusBadge = useMemo(() => {
    switch (liveStatus) {
      case 'ONLINE':
        return (
          <span className="badge-real-device badge-real-online">
            <span className="live-ping-dot" />
            <IconCheckCircle /> ONLINE (Đang hoạt động)
          </span>
        );
      case 'WARNING':
        return (
          <span className="badge-real-device badge-real-warning">
            <IconAlertTriangle /> WARNING (Cần kiểm tra)
          </span>
        );
      case 'OFFLINE':
      default:
        return (
          <span className="badge-real-device badge-real-offline">
            <IconXCircle /> OFFLINE (Mất kết nối)
          </span>
        );
    }
  }, [liveStatus]);

  // Kiểm tra cảm biến siêu âm đã có dữ liệu thực tế chưa
  const hasUltrasonicSensorData = useMemo(() => {
    return (
      data?.sensors !== null &&
      data?.sensors !== undefined &&
      typeof data.sensors.distanceCm === 'number'
    );
  }, [data]);

  const yoloStatus = data?.subsystems?.yolo || 'STOPPED';
  const cameraStatus = data?.subsystems?.camera || 'DISCONNECTED';
  const esp32Status = data?.subsystems?.esp32 || 'DISCONNECTED';

  const yoloPill = useMemo(() => {
    if (yoloStatus === 'RUNNING') return { cls: 'is-ok', text: 'RUNNING (Đang chạy)' };
    if (yoloStatus === 'ERROR') return { cls: 'is-error', text: 'ERROR (Lỗi)' };
    if (yoloStatus === 'UNAVAILABLE') return { cls: 'is-warning', text: 'UNAVAILABLE (Chưa cài)' };
    return { cls: 'is-warning', text: 'STOPPED (Đang dừng)' };
  }, [yoloStatus]);

  const cameraPill = useMemo(() => {
    if (cameraStatus === 'CONNECTED') return { cls: 'is-ok', text: 'CONNECTED (Rapoo C200)' };
    if (cameraStatus === 'ERROR') return { cls: 'is-error', text: 'ERROR (Lỗi camera)' };
    return { cls: 'is-warning', text: 'DISCONNECTED (Chưa cắm)' };
  }, [cameraStatus]);

  const esp32Pill = useMemo(() => {
    if (esp32Status === 'CONNECTED') return { cls: 'is-ok', text: 'CONNECTED (115200 baud)' };
    if (esp32Status === 'ERROR') return { cls: 'is-error', text: 'ERROR (Lỗi Serial)' };
    return { cls: 'is-warning', text: 'DISCONNECTED (Chưa cắm USB)' };
  }, [esp32Status]);

  const renderCompartmentCard = (
    key: string,
    label: string,
    comp?: CompartmentFillData | null
  ) => {
    const hasReading = comp && comp.fillLevel !== null && comp.fillLevel !== undefined;
    const fillPct = hasReading ? Math.min(100, Math.max(0, comp.fillLevel!)) : 0;
    const isStale = comp?.status === 'STALE';
    const isError = comp?.status === 'SENSOR_ERROR' || comp?.status === 'OUT_OF_RANGE';
    const isNotAttached = !comp || comp.status === 'NOT_ATTACHED' || comp.status === undefined;

    let tone = 'normal';
    if (fillPct >= 90) tone = 'critical';
    else if (fillPct >= 70) tone = 'warning';

    return (
      <div key={key} className="compartment-gauge-card">
        <div className="compartment-gauge-head">
          <span className="compartment-name">{label}</span>
          {isStale ? (
            <span className="compartment-status-tag tag-stale">Dữ liệu cũ (STALE)</span>
          ) : isError ? (
            <span className="compartment-status-tag tag-error">Lệch tầm đo</span>
          ) : isNotAttached ? (
            <span className="compartment-status-tag tag-stale">Chưa gắn</span>
          ) : (
            <span className="compartment-status-tag tag-ok">HOẠT ĐỘNG</span>
          )}
        </div>

        <div className="compartment-fill-display">
          <span className="compartment-fill-pct">
            {hasReading ? `${fillPct}%` : '—'}
          </span>
          <span className="compartment-distance">
            {comp?.distanceCm !== null && comp?.distanceCm !== undefined
              ? `${comp.distanceCm.toFixed(1)} cm`
              : 'Chờ đo'}
          </span>
        </div>

        <div className="compartment-progress-bar">
          <div
            className={`compartment-progress-fill fill-tone-${tone}`}
            style={{ width: `${hasReading ? fillPct : 0}%` }}
          />
        </div>

        {isStale && (
          <div className="compartment-stale-banner">
            <IconAlertTriangle />
            <span>Cảm biến không gửi dữ liệu mới &gt; 15s (Stale)</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className={`real-device-container ${compact ? 'compact' : ''} ${pulse ? 'has-pulse' : ''}`}>
      <div className="real-device-card">
        {/* Header with Title and Hardware Tag */}
        <div className="real-device-card__head">
          <div className="real-device-card__title-box">
            <div className="real-hardware-pill">
              <span className="real-hardware-dot" />
              <span>PHẦN CỨNG THỰC TẾ (REAL HARDWARE)</span>
            </div>
            <div className="real-device-card__main-title">
              <div className="real-device-icon-wrapper">
                <IconCpu />
              </div>
              <div>
                <h3>{data?.deviceName || 'Raspberry Pi 5'}</h3>
                <p className="real-device-subtitle">
                  Giao tiếp thời gian thực hai chiều qua Socket.IO &amp; HTTP Heartbeat. Độc lập với dữ liệu mô phỏng.
                </p>
              </div>
            </div>
          </div>

          <div className="real-device-card__actions">
            <div className={`realtime-badge ${realtimeConnected ? 'is-connected' : 'is-disconnected'}`}>
              <span className="status-dot" />
              <span>{realtimeConnected ? 'Socket Web: Sẵn sàng' : 'Socket Web: Đang kết nối...'}</span>
            </div>
            <button
              type="button"
              className="button-secondary button-sm"
              onClick={handleManualRefresh}
              disabled={refreshing}
              title="Làm mới trạng thái thiết bị thực"
            >
              <IconRefresh />
              <span>{refreshing ? 'Đang tải...' : 'Làm mới'}</span>
            </button>
          </div>
        </div>

        {/* Status Alert Banner if Error */}
        {error && (
          <div className="real-device-error-banner">
            <IconAlertTriangle />
            <span>{error}</span>
          </div>
        )}

        {/* Loading Skeleton if first load */}
        {loading && !data ? (
          <div className="real-device-loading">Đang kết nối và kiểm tra thiết bị Raspberry Pi 5...</div>
        ) : (
          <>
            {/* Subsystems Strip: YOLO AI, Rapoo C200 Camera, ESP32 Serial */}
            <div className="real-subsystems-strip">
              <span className="real-subsystems-title">
                <IconCpu />
                <span>Hệ Thống Con:</span>
              </span>

              <div className={`subsystem-pill ${yoloPill.cls}`} title="Trạng thái tiến trình AI YOLO trong môi trường ảo venv">
                <span className="subsystem-dot" />
                <span>YOLO AI: {yoloPill.text}</span>
              </div>

              <div className={`subsystem-pill ${cameraPill.cls}`} title="Rapoo C200 USB Camera (/dev/video*)">
                <span className="subsystem-dot" />
                <span>Camera: {cameraPill.text}</span>
              </div>

              <div className={`subsystem-pill ${esp32Pill.cls}`} title="ESP32 USB Serial (115200 baud, newline-delimited JSON)">
                <span className="subsystem-dot" />
                <span>ESP32 Serial: {esp32Pill.text}</span>
              </div>
            </div>

            {/* Real Hardware Metrics Grid */}
            <div className="real-device-metrics-grid">
              {/* Metric 1: Trạng thái kết nối */}
              <div className={`real-metric-card real-metric-status real-metric--${liveStatus.toLowerCase()}`}>
                <span className="metric-label">Trạng thái kết nối</span>
                <div className="metric-value-row">{statusBadge}</div>
                <span className="metric-hint">
                  {liveStatus === 'ONLINE'
                    ? 'Nhận nhịp tín hiệu đều đặn từ Pi 5'
                    : liveStatus === 'WARNING'
                    ? 'Tín hiệu bị trễ (quá ngưỡng 15 giây)'
                    : 'Chưa phát hiện nhịp tín hiệu gần đây (> 30 giây)'}
                </span>
              </div>

              {/* Metric 2: Lần heartbeat gần nhất */}
              <div className="real-metric-card">
                <span className="metric-label">Heartbeat gần nhất</span>
                <strong className="metric-value">
                  {renderAgeText(liveAgeSeconds)}
                </strong>
                <span className="metric-hint" title={data?.lastHeartbeat || ''}>
                  {data?.lastHeartbeat ? formatDateTime(data.lastHeartbeat) : 'Chưa có nhịp nào'}
                </span>
              </div>

              {/* Metric 3: Uptime */}
              <div className="real-metric-card">
                <span className="metric-label">Thời gian hoạt động (Uptime)</span>
                <strong className="metric-value">
                  {data?.uptimeSeconds !== null && data?.uptimeSeconds !== undefined
                    ? formatUptime(data.uptimeSeconds)
                    : '—'}
                </strong>
                <span className="metric-hint">
                  {data?.uptimeSeconds ? `${data.uptimeSeconds.toLocaleString()} giây liên tục` : 'Chờ Pi gửi nhịp'}
                </span>
              </div>

              {/* Metric 4: Số lượng gói tin */}
              <div className="real-metric-card">
                <span className="metric-label">Tổng gói Telemetry</span>
                <strong className="metric-value">
                  {data?.heartbeatCount ? `${data.heartbeatCount.toLocaleString()} gói` : '0 gói'}
                </strong>
                <span className="metric-hint">
                  {data?.heartbeatCount && data.heartbeatCount > 0
                    ? 'Đã xác thực Bearer token'
                    : 'Chưa nhận gói tin nào'}
                </span>
              </div>

              {/* Metric 5: Nhiệt độ CPU */}
              <div className="real-metric-card">
                <span className="metric-label">Nhiệt độ CPU Pi 5</span>
                <strong className="metric-value">
                  {data?.cpuTempC !== null && data?.cpuTempC !== undefined
                    ? `${data.cpuTempC.toFixed(1)}°C`
                    : '—'}
                </strong>
                <span className="metric-hint">
                  {data?.cpuTempC
                    ? data.cpuTempC < 60
                      ? 'Nhiệt độ ổn định'
                      : data.cpuTempC < 75
                      ? 'Nhiệt độ ấm'
                      : 'Nhiệt độ cao'
                    : 'Chờ cảm biến nhiệt'}
                </span>
              </div>

              {/* Metric 6: Kênh kết nối Pi 5 */}
              <div className="real-metric-card">
                <span className="metric-label">Kênh kết nối Pi 5</span>
                <div style={{ marginTop: '4px' }}>
                  {data?.isSocketConnected ? (
                    <span className="real-device-channel-badge socket-direct">
                      <span className="live-ping-dot" style={{ width: 6, height: 6 }} />
                      Socket.IO Trực tiếp
                    </span>
                  ) : (
                    <span className="real-device-channel-badge http-fallback">
                      HTTP Heartbeat
                    </span>
                  )}
                </div>
                <span className="metric-hint">
                  {data?.isSocketConnected ? 'Hỗ trợ lệnh hai chiều tức thì' : 'Đang ở chế độ nhịp HTTP'}
                </span>
              </div>

              {/* Metric 7: Cảm biến siêu âm thực tế (nếu Pi đã gửi) */}
              {hasUltrasonicSensorData && (
                <div className="real-metric-card">
                  <span className="metric-label">Cảm biến siêu âm</span>
                  <strong className="metric-value">
                    {data?.sensors?.distanceCm !== null && data?.sensors?.distanceCm !== undefined
                      ? `${data.sensors.distanceCm.toFixed(1)} cm`
                      : '—'}
                  </strong>
                  <span className="metric-hint">
                    {data?.sensors?.fillLevel !== null && data?.sensors?.fillLevel !== undefined
                      ? `Mức đầy: ${data.sensors.fillLevel}%`
                      : 'Dữ liệu đo thực tế'}
                  </span>
                </div>
              )}
            </div>

            {/* AI Detection Panel */}
            <div className="real-device-ai-panel">
              <div className="real-device-ai-header">
                <div className="real-device-ai-title">
                  <IconCamera />
                  <span>Nhận Diện Thị Giác AI (YOLO Camera Realtime)</span>
                </div>
                {data?.aiDetection?.timestamp && (
                  <span className="metric-hint">
                    Thời gian: {formatDateTime(data.aiDetection.timestamp)}
                  </span>
                )}
              </div>

              {data?.aiDetection ? (
                <div className="ai-detection-body">
                  <div className="ai-class-badge-wrapper">
                    <span className={`ai-class-tag tag-${data.aiDetection.class.toLowerCase().replace('_', '-')}`}>
                      {data.aiDetection.class === 'ORGANIC'
                        ? 'RÁC HỮU CƠ'
                        : data.aiDetection.class === 'RECYCLABLE'
                        ? 'RÁC TÁI CHẾ'
                        : 'RÁC KHÔNG TÁI CHẾ'}
                    </span>
                    {data.aiDetection.rawClass &&
                      data.aiDetection.rawClass.toLowerCase() !== data.aiDetection.class.toLowerCase() && (
                        <span className="metric-hint">({data.aiDetection.rawClass})</span>
                      )}
                  </div>

                  <div className="ai-stats-row">
                    <span className="ai-stat-item">
                      Độ tin cậy: <strong>{formatConfidence(data.aiDetection.confidence)}</strong>
                    </span>
                    {typeof data.aiDetection.inferenceTimeMs === 'number' && (
                      <span className="ai-stat-item">
                        Độ trễ AI: <strong>{data.aiDetection.inferenceTimeMs} ms</strong>
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="ai-detection-body" style={{ color: '#63756b', fontStyle: 'italic', fontSize: '13px' }}>
                  Chưa có nhận diện rác mới (Đang chờ vật thể đưa vào vùng nhìn của Camera Rapoo C200...)
                </div>
              )}
            </div>

            {/* 3-Compartment Fill Level Grid */}
            <div className="real-compartments-section">
              <div className="real-compartments-title">
                <h4>
                  <IconRadio />
                  <span>Mức Đầy 3 Ngăn Rác Thực Tế (ESP32 HC-SR04)</span>
                </h4>
                <span className="metric-hint">Hiệu chuẩn: 50cm (Trống) → 5cm (Đầy)</span>
              </div>

              <div className="real-compartments-grid">
                {renderCompartmentCard('ORGANIC', 'Rác hữu cơ', data?.sensors?.organic)}
                {renderCompartmentCard('RECYCLABLE', 'Rác tái chế', data?.sensors?.recyclable)}
                {renderCompartmentCard('NON_RECYCLABLE', 'Rác không tái chế', data?.sensors?.nonRecyclable)}
              </div>
            </div>

            {/* BẢNG ĐIỀU KHIỂN LỆNH HAI CHIỀU (Bi-directional Controls) */}
            <div className="real-device-control-panel">
              <div className="real-device-control-header">
                <div className="real-device-control-title">
                  <IconRadio />
                  <span>Điều Khiển Hai Chiều (Bi-directional Commands)</span>
                </div>
                <div>
                  {data?.isSocketConnected ? (
                    <span className="real-device-channel-badge socket-direct" title="Pi 5 đang duy trì kết nối Socket.IO">
                      Kênh: Socket.IO Sẵn Sàng
                    </span>
                  ) : (
                    <span className="real-device-channel-badge http-fallback" title="Pi 5 cần kết nối Socket.IO để nhận lệnh">
                      Kênh: Chờ Pi 5 kết nối Socket.IO
                    </span>
                  )}
                </div>
              </div>

              <div className="real-device-actions-row">
                {/* Nút 1: PING Thiết Bị */}
                <button
                  type="button"
                  className={`button-control-action button-ping ${commandState.status === 'PENDING' && commandState.action === 'PING' ? 'is-loading' : ''}`}
                  onClick={handleSendPing}
                  disabled={liveStatus === 'OFFLINE' || commandState.status === 'PENDING' || !canExecuteCommands}
                  title={!canExecuteCommands ? 'Yêu cầu quyền Quản trị viên hoặc Giám sát viên để gửi lệnh' : liveStatus === 'OFFLINE' ? 'Không thể PING khi Pi đang OFFLINE' : 'Gửi lệnh PING kiểm tra kết nối hai chiều tới Pi 5'}
                >
                  {commandState.status === 'PENDING' && commandState.action === 'PING' ? (
                    <>
                      <span className="control-spinner" />
                      <span>Đang PING...</span>
                    </>
                  ) : (
                    <>
                      <IconActivity />
                      <span>PING Pi 5 (Kiểm tra phản hồi)</span>
                    </>
                  )}
                </button>

                {/* Nút 2: TRIGGER_ULTRASONIC (Đo cảm biến siêu âm) */}
                <button
                  type="button"
                  className={`button-control-action button-ultrasonic ${commandState.status === 'PENDING' && commandState.action === 'TRIGGER_ULTRASONIC' ? 'is-loading' : ''}`}
                  onClick={handleTriggerUltrasonic}
                  disabled={liveStatus === 'OFFLINE' || commandState.status === 'PENDING' || !canExecuteCommands}
                  title={!canExecuteCommands ? 'Yêu cầu quyền Quản trị viên hoặc Giám sát viên để gửi lệnh' : liveStatus === 'OFFLINE' ? 'Không thể đo khi Pi đang OFFLINE' : 'Yêu cầu Pi 5 kích hoạt đọc cảm biến siêu âm'}
                >
                  {commandState.status === 'PENDING' && commandState.action === 'TRIGGER_ULTRASONIC' ? (
                    <>
                      <span className="control-spinner spinner-dark" />
                      <span>Đang yêu cầu đo...</span>
                    </>
                  ) : (
                    <>
                      <IconRadio />
                      <span>
                        {hasUltrasonicSensorData ? 'Đo cảm biến siêu âm ngay' : 'Kiểm tra cảm biến siêu âm'}
                      </span>
                    </>
                  )}
                </button>
              </div>

              {/* Thông báo trạng thái phản hồi lệnh (Command Feedback Banner) */}
              {commandState.status !== 'IDLE' && (
                <div className={`real-device-command-feedback feedback-status-${commandState.status.toLowerCase()}`}>
                  <div className="feedback-left">
                    {commandState.status === 'PENDING' && <span className="control-spinner spinner-dark" />}
                    {commandState.status === 'COMPLETED' && <IconCheckCircle />}
                    {commandState.status === 'FAILED' && <IconXCircle />}
                    {commandState.status === 'TIMEOUT' && <IconAlertTriangle />}
                    <span>{commandState.message}</span>
                  </div>

                  {typeof commandState.latencyMs === 'number' && (
                    <span className="feedback-latency-badge">
                      Độ trễ: {commandState.latencyMs} ms
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Quick Test / Integration Instructions toggle */}
            <div className="real-device-guide-section">
              <button
                type="button"
                className="guide-toggle-button"
                onClick={() => setShowGuide((prev) => !prev)}
              >
                <IconInfo />
                <span>
                  {showGuide ? 'Ẩn hướng dẫn kết nối Pi 5 qua Socket.IO / PuTTY' : 'Xem hướng dẫn chạy Pi Agent hai chiều & lệnh cURL'}
                </span>
              </button>

              {showGuide && (
                <div className="guide-content-box">
                  <p className="guide-desc">
                    <strong>Cách 1: Chạy Pi Agent hai chiều (Khuyên dùng - Hỗ trợ PING &amp; Telemetry liên tục):</strong>
                  </p>
                  <pre className="guide-code-block">
{`# 1. Kết nối qua PuTTY vào Pi 5 (Debian 13 ARM64)
# 2. Cài đặt thư viện vào virtualenv:
pip install python-socketio[client] requests python-dotenv

# 3. Chạy script agent (trong apps/device/pi_agent.py):
python3 pi_agent.py`}
                  </pre>

                  <p className="guide-desc" style={{ marginTop: '10px' }}>
                    <strong>Cách 2: Gửi HTTP Heartbeat dự phòng qua cURL (Tương thích ngược):</strong>
                  </p>
                  <pre className="guide-code-block">
{`curl -X POST https://smartbin-api-e08b.onrender.com/api/demo/device-heartbeat \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <DEVICE_INGEST_TOKEN>" \\
  -d '{
    "deviceId": "raspberry-pi-5",
    "status": "ONLINE",
    "uptimeSeconds": '$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 120)',
    "cpuTempC": '$(awk '{print $1/1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 48.5)',
    "sentAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
  }'`}
                  </pre>
                  <p className="guide-note">
                    * Lưu ý: Token xác thực được lưu trong file <code>.env</code> trên Pi và cấu hình trên Render (không hiển thị công khai).
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

