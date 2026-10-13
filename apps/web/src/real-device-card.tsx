import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRealtime } from './realtime-store';
import { apiUrl } from './api-config';
import {
  IconCpu,
  IconCheckCircle,
  IconAlertTriangle,
  IconXCircle,
  IconRefresh,
  IconInfo
} from './icons';
import { formatDateTime, formatUptime } from './device-utils';

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
  metadata?: {
    staleThresholdSeconds: number;
    offlineThresholdSeconds: number;
    platform: string;
  };
}

interface RealDeviceCardProps {
  /** Optional title or section context */
  compact?: boolean;
}

export function RealDeviceCard({ compact = false }: RealDeviceCardProps) {
  const { socket, connected: realtimeConnected } = useRealtime();
  const [data, setData] = useState<RealDeviceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Update clock every second for live age calculation
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initial fetch
  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/api/demo/device-status`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: Không thể tải trạng thái thiết bị thực.`);
        }
        return res.json();
      })
      .then((json) => {
        if (active && json.success && json.data) {
          setData(json.data);
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
  }, []);

  const handleManualRefresh = useCallback(() => {
    setRefreshing(true);
    fetch(`${apiUrl}/api/demo/device-status`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: Không thể tải trạng thái thiết bị thực.`);
        }
        return res.json();
      })
      .then((json) => {
        if (json.success && json.data) {
          setData(json.data);
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

  // Realtime Socket.IO listener for device:heartbeat
  useEffect(() => {
    if (!socket) return;

    const handleHeartbeat = (payload: RealDeviceData) => {
      setData(payload);
      setError(null);
      // Trigger heartbeat animation pulse
      setPulse(true);
      const timeout = setTimeout(() => setPulse(false), 1200);
      return () => clearTimeout(timeout);
    };

    socket.on('device:heartbeat', handleHeartbeat);

    return () => {
      socket.off('device:heartbeat', handleHeartbeat);
    };
  }, [socket]);

  // Calculate live age and real status
  const { liveAgeSeconds, liveStatus } = useMemo(() => {
    if (!data || !data.lastHeartbeat) {
      return { liveAgeSeconds: null, liveStatus: 'OFFLINE' as const };
    }

    const lastTime = new Date(data.lastHeartbeat).getTime();
    if (isNaN(lastTime)) {
      return { liveAgeSeconds: null, liveStatus: 'OFFLINE' as const };
    }

    const age = Math.max(0, Math.floor((now - lastTime) / 1000));
    const staleLimit = data.metadata?.staleThresholdSeconds ?? 45;
    const offlineLimit = data.metadata?.offlineThresholdSeconds ?? 90;

    let status: 'ONLINE' | 'STALE' | 'OFFLINE' = 'ONLINE';
    if (age >= offlineLimit) {
      status = 'OFFLINE';
    } else if (age >= staleLimit) {
      status = 'STALE';
    }

    return { liveAgeSeconds: age, liveStatus: status };
  }, [data, now]);

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
                  Xác nhận kết nối vật lý thật qua HTTP Heartbeat &amp; Socket.IO realtime. Độc lập với dữ liệu mô phỏng.
                </p>
              </div>
            </div>
          </div>

          <div className="real-device-card__actions">
            <div className={`realtime-badge ${realtimeConnected ? 'is-connected' : 'is-disconnected'}`}>
              <span className="status-dot" />
              <span>{realtimeConnected ? 'Socket: Sẵn sàng' : 'Socket: Đang kết nối...'}</span>
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
              {/* Metric 1: Trạng thái */}
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

              {/* Metric 4: Số lượng Heartbeat */}
              <div className="real-metric-card">
                <span className="metric-label">Tổng số Heartbeat</span>
                <strong className="metric-value">
                  {data?.heartbeatCount ? `${data.heartbeatCount.toLocaleString()} gói` : '0 gói'}
                </strong>
                <span className="metric-hint">
                  {data?.heartbeatCount && data.heartbeatCount > 0
                    ? 'Đã xác thực thành công'
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
                    : 'Chưa có đo đạc'}
                </span>
              </div>

              {/* Metric 6: Mã thiết bị ID */}
              <div className="real-metric-card">
                <span className="metric-label">Mã định danh (Device ID)</span>
                <strong className="metric-value metric-device-code">
                  {data?.deviceId || 'raspberry-pi-5'}
                </strong>
                <span className="metric-hint">Nền tảng: {data?.metadata?.platform || 'Raspberry Pi 5'}</span>
              </div>
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
                  {showGuide ? 'Ẩn lệnh cURL mẫu gửi nhịp cho Pi 5' : 'Xem lệnh cURL mẫu gửi Heartbeat từ Raspberry Pi 5'}
                </span>
              </button>

              {showGuide && (
                <div className="guide-content-box">
                  <p className="guide-desc">
                    Chạy lệnh sau trên terminal của Raspberry Pi 5 để gửi heartbeat kiểm tra kết nối lên Render:
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
                    * Lưu ý: Thay <code>&lt;DEVICE_INGEST_TOKEN&gt;</code> bằng token cấu hình trên Render Environment Variables.
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
