import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRealtime } from './realtime-store';
import { apiUrl } from './api-config';
import {
  IconCpu,
  IconCheckCircle,
  IconAlertTriangle,
  IconXCircle,
  IconRefresh,
  IconInfo,
  IconRadio,
  IconActivity
} from './icons';
import { formatDateTime, formatUptime } from './device-utils';

export interface DeviceSensorsData {
  distanceCm?: number | null;
  fillLevel?: number | null;
}

export interface RealDeviceData {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  isReal: boolean;
  status: 'ONLINE' | 'STALE' | 'OFFLINE';
  uptimeSeconds: number | null;
  cpuTempC: number | null;
  lastHeartbeat: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  heartbeatCount: number;
  ageSeconds: number | null;
  isSocketConnected?: boolean;
  sensors?: DeviceSensorsData | null;
  metadata?: {
    staleThresholdSeconds: number;
    offlineThresholdSeconds: number;
    platform: string;
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
  const [data, setData] = useState<RealDeviceData | null>(null);
  const [receivedAtLocalMs, setReceivedAtLocalMs] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [now, setNow] = useState(() => Date.now());

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
        if (active && json.success && json.data) {
          setData(json.data);
          setReceivedAtLocalMs(Date.now());
          setError(null);
        }
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
        if (json.success && json.data) {
          setData(json.data);
          setReceivedAtLocalMs(Date.now());
          setError(null);
        }
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
      setData(payload);
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

    socket.on('device:heartbeat', handleHeartbeat);
    socket.on('device:command:status', handleCommandStatus);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('device:heartbeat', handleHeartbeat);
      socket.off('device:command:status', handleCommandStatus);
      socket.off('connect', handleReconnect);
    };
  }, [socket, handleManualRefresh]);

  // Calculate live age and real status eliminating client-server clock skew
  const { liveAgeSeconds, liveStatus } = useMemo(() => {
    if (!data || !data.lastHeartbeat || data.heartbeatCount === 0) {
      return { liveAgeSeconds: null, liveStatus: 'OFFLINE' as const };
    }

    // Elapsed seconds on client browser since this telemetry packet arrived
    const elapsedSinceReceive = Math.max(0, Math.floor((now - receivedAtLocalMs) / 1000));

    // Base age reported by server at delivery time + client elapsed seconds
    const serverBaseAge = typeof data.ageSeconds === 'number' && !isNaN(data.ageSeconds) ? data.ageSeconds : 0;
    const effectiveAge = serverBaseAge + elapsedSinceReceive;

    const staleLimit = data.metadata?.staleThresholdSeconds ?? 45;
    const offlineLimit = data.metadata?.offlineThresholdSeconds ?? 90;

    let computedStatus: 'ONLINE' | 'STALE' | 'OFFLINE' = 'ONLINE';
    if (effectiveAge >= offlineLimit) {
      computedStatus = 'OFFLINE';
    } else if (effectiveAge >= staleLimit) {
      computedStatus = 'STALE';
    }

    return { liveAgeSeconds: effectiveAge, liveStatus: computedStatus };
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

    setCommandState({
      status: 'PENDING',
      action: 'PING',
      message: 'Đang gửi lệnh PING tới Raspberry Pi 5...',
      updatedAt: Date.now()
    });

    try {
      const res = await fetch(`${apiUrl}/api/demo/device-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          deviceId: data?.deviceId || 'raspberry-pi-5',
          action: 'PING'
        })
      });

      const json = await res.json();
      if (!res.ok) {
        setCommandState({
          status: json.error === 'COMMAND_TIMEOUT' ? 'TIMEOUT' : 'FAILED',
          action: 'PING',
          message: json.message || 'Lệnh PING thất bại',
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

    setCommandState({
      status: 'PENDING',
      action: 'TRIGGER_ULTRASONIC',
      message: 'Đang gửi yêu cầu đo cảm biến siêu âm tới Pi 5...',
      updatedAt: Date.now()
    });

    try {
      const res = await fetch(`${apiUrl}/api/demo/device-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          deviceId: data?.deviceId || 'raspberry-pi-5',
          action: 'TRIGGER_ULTRASONIC'
        })
      });

      const json = await res.json();
      if (!res.ok) {
        setCommandState({
          status: json.error === 'COMMAND_TIMEOUT' ? 'TIMEOUT' : 'FAILED',
          action: 'TRIGGER_ULTRASONIC',
          message: json.message || 'Cảm biến chưa sẵn sàng hoặc chưa kết nối chân GPIO vật lý.',
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
            <IconCheckCircle /> ONLINE (Hoạt động)
          </span>
        );
      case 'STALE':
        return (
          <span className="badge-real-device badge-real-stale">
            <IconAlertTriangle /> STALE (&gt;45s chưa có nhịp)
          </span>
        );
      case 'OFFLINE':
      default:
        return (
          <span className="badge-real-device badge-real-offline">
            <IconXCircle /> OFFLINE (Chưa kết nối)
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
            {/* Real Hardware Metrics Grid */}
            <div className="real-device-metrics-grid">
              {/* Metric 1: Trạng thái kết nối */}
              <div className={`real-metric-card real-metric-status real-metric--${liveStatus.toLowerCase()}`}>
                <span className="metric-label">Trạng thái kết nối</span>
                <div className="metric-value-row">{statusBadge}</div>
                <span className="metric-hint">
                  {liveStatus === 'ONLINE'
                    ? 'Nhận nhịp tín hiệu đều đặn từ Pi 5'
                    : liveStatus === 'STALE'
                    ? 'Tín hiệu bị trễ (> 45 giây)'
                    : 'Chưa phát hiện nhịp tín hiệu gần đây'}
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
                  disabled={liveStatus === 'OFFLINE' || commandState.status === 'PENDING'}
                  title={liveStatus === 'OFFLINE' ? 'Không thể PING khi Pi đang OFFLINE' : 'Gửi lệnh PING kiểm tra kết nối hai chiều tới Pi 5'}
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
                  disabled={liveStatus === 'OFFLINE' || commandState.status === 'PENDING'}
                  title={liveStatus === 'OFFLINE' ? 'Không thể đo khi Pi đang OFFLINE' : 'Yêu cầu Pi 5 kích hoạt đọc cảm biến siêu âm'}
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

