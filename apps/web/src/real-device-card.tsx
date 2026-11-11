import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRealtime } from './realtime-store';
import { apiUrl } from './api-config';
import {
  IconCpu,
  IconCheckCircle,
  IconAlertTriangle,
  IconXCircle,
  IconRefresh
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
  lidAlert?: boolean;
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

interface RealDeviceCardProps {
  /** Optional compact styling */
  compact?: boolean;
  /** External trigger to refresh card (e.g. from page header refresh button) */
  refreshTrigger?: number | string;
}

export function RealDeviceCard({ compact = false, refreshTrigger }: RealDeviceCardProps) {
  const { socket, connected: realtimeConnected } = useRealtime();
  const [data, setData] = useState<RealDeviceData | null>(null);
  const [receivedAtLocalMs, setReceivedAtLocalMs] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Timestamp guard using ref to avoid unsafe state updater side-effects
  const latestHeartbeatTsRef = useRef<number>(0);

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

  // Realtime Socket.IO listeners: device:heartbeat, device:status, and reconnection sync
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
          lidAlert: payload.lidAlert ? true : prev.lidAlert,
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
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('device:heartbeat', handleHeartbeat);
      socket.off('device:status', handleDeviceStatus);
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

  return (
    <section className={`real-device-container ${compact ? 'compact' : ''} ${pulse ? 'has-pulse' : ''}`}>
      <div className="real-device-card">
        {/* Header with Title */}
        <div className="real-device-card__head">
          <div className="real-device-card__title-box">
            <div className="real-device-card__main-title">
              <div className="real-device-icon-wrapper">
                <IconCpu />
              </div>
              <div>
                <h3>{data?.deviceName || 'Raspberry Pi 5'}</h3>
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
                  {data?.isSocketConnected ? 'Duy trì kết nối hai chiều' : 'Đang ở chế độ nhịp HTTP'}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
