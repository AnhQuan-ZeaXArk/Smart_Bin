import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from './auth-context';
import { translateAlertSeverity } from './i18n-labels';
import type { Bin, FillCategory } from './bins';
import { getFillLevelStatus, FILL_LEVEL_STATUS_LABEL, FILL_LEVEL_STATUS_TONE, readSmartBinThresholds } from './threshold-config';
import { getCompartments, WASTE_CATEGORY_LABEL, WASTE_CATEGORY_ORDER, type WasteCategoryKey } from './waste-category';
import {
  type DeviceType,
  type DeviceStatusEnum,
  type DeviceItem,
  DEVICE_TYPE_LABELS,
  STATUS_LABELS,
  formatDateTime
} from './device-utils';
import {
  IconCpu,
  IconCamera,
  IconRadio,
  IconServer,
  IconCheckCircle,
  IconAlertTriangle,
  IconXCircle,
  IconActivity
} from './icons';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

type RealtimeTelemetry = {
  binCode: string;
  fillLevel: number;
  fillCategory: FillCategory;
  distanceCm: number;
  timestamp: string;
};

type Summary = {
  total: number;
  normal: number;
  warning: number;
  full: number;
  offline: number;
};

export type DashboardAlert = {
  id: string;
  type: string;
  severity: string;
  message: string;
  createdAt: string;
  bin: { binCode: string; name?: string } | null;
  deviceId?: string | null;
  isResolved?: boolean;
};

type DashboardData = {
  summary: Summary;
  bins: (Bin & { distanceCm: number | null })[];
  recentSensorReadings: {
    id: string;
    fillLevel: number;
    distance: number;
    timestamp: string;
    bin: { binCode: string; name: string };
  }[];
  devices?: DeviceItem[];
  alerts: DashboardAlert[];
};

async function getData<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Không thể tải dữ liệu từ máy chủ.');
  return response.json() as Promise<T>;
}

function ago(value: string | null) {
  return value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có dữ liệu';
}

function badge(value: string) {
  return value.toLowerCase().replace('_', '-');
}

function getDeviceIcon(type: DeviceType) {
  switch (type) {
    case 'RASPBERRY_PI':
      return <IconCpu />;
    case 'CAMERA':
      return <IconCamera />;
    case 'ULTRASONIC_SENSOR':
      return <IconRadio />;
    case 'MQTT':
      return <IconServer />;
    default:
      return <IconActivity />;
  }
}

function getStatusBadge(status: DeviceStatusEnum) {
  switch (status) {
    case 'ONLINE':
      return (
        <span className="badge badge-device-status badge-device-online">
          <IconCheckCircle /> {STATUS_LABELS.ONLINE}
        </span>
      );
    case 'WARNING':
      return (
        <span className="badge badge-device-status badge-device-warning">
          <IconAlertTriangle /> {STATUS_LABELS.WARNING}
        </span>
      );
    case 'OFFLINE':
      return (
        <span className="badge badge-device-status badge-device-offline">
          <IconXCircle /> {STATUS_LABELS.OFFLINE}
        </span>
      );
    default:
      return <span className="badge">{status}</span>;
  }
}

function mergeTelemetry(data: DashboardData, event: RealtimeTelemetry): DashboardData {
  const bins = data.bins.map((bin) =>
    bin.binCode === event.binCode
      ? {
          ...bin,
          currentFillLevel: event.fillLevel,
          fillCategory: event.fillCategory,
          distanceCm: event.distanceCm,
          lastSeen: event.timestamp,
          status: 'ONLINE' as const
        }
      : bin
  );
  const thresholds = readSmartBinThresholds();
  const summary = {
    ...data.summary,
    normal: bins.filter((bin) => getFillLevelStatus(bin.currentFillLevel, thresholds) === 'NORMAL').length,
    warning: bins.filter((bin) => getFillLevelStatus(bin.currentFillLevel, thresholds) === 'WARNING').length,
    full: bins.filter((bin) => getFillLevelStatus(bin.currentFillLevel, thresholds) === 'FULL').length,
    offline: bins.filter((bin) => bin.status === 'OFFLINE').length
  };
  return {
    ...data,
    bins,
    summary,
    recentSensorReadings: [
      {
        id: `live-${event.binCode}-${event.timestamp}`,
        fillLevel: event.fillLevel,
        distance: event.distanceCm,
        timestamp: event.timestamp,
        bin: { binCode: event.binCode, name: bins.find((bin) => bin.binCode === event.binCode)?.name ?? event.binCode }
      },
      ...data.recentSensorReadings
    ].slice(0, 8)
  };
}

export function DashboardPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);

  // Device Health monitoring state
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [deviceLoading, setDeviceLoading] = useState(true);
  const [deviceError, setDeviceError] = useState('');

  // Alerts state
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);

  // Load Dashboard summary data
  useEffect(() => {
    let active = true;
    if (!token) return;

    getData<DashboardData>('/api/dashboard/summary', token)
      .then((result) => {
        if (active) {
          setData(result);
          setAlerts(result.alerts || []);
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Không thể tải trang tổng quan.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  // Load Device list data independently
  useEffect(() => {
    let active = true;
    if (!token) return;

    getData<{ devices: DeviceItem[] }>('/api/devices', token)
      .then((result) => {
        if (active) setDevices(result.devices || []);
      })
      .catch((devErr) => {
        if (active) setDeviceError(devErr instanceof Error ? devErr.message : 'Không thể tải tình trạng thiết bị.');
      })
      .finally(() => {
        if (active) setDeviceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  // Realtime Socket.IO subscriptions
  useEffect(() => {
    if (!token) return;

    const realtime = io(apiUrl, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    realtime.on('connect', () => setConnected(true));
    realtime.on('disconnect', () => setConnected(false));
    realtime.on('connect_error', () => setConnected(false));

    // Telemetry updates
    realtime.on('bin:telemetry', (event: RealtimeTelemetry) => {
      setData((current) => (current ? mergeTelemetry(current, event) : current));
    });

    // Realtime device health status updates
    realtime.on('device:status', (updated: DeviceItem) => {
      setDevices((prev) => {
        const index = prev.findIndex((d) => d.deviceId === updated.deviceId || d.id === updated.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...next[index], ...updated };
          return next;
        }
        return [...prev, updated];
      });
    });

    // Realtime alert events
    realtime.on('alert:created', (newAlert: DashboardAlert) => {
      setAlerts((prev) => {
        if (prev.some((a) => a.id === newAlert.id)) return prev;
        return [newAlert, ...prev].slice(0, 10);
      });
    });

    realtime.on('alert:resolved', (resolved: { id?: string; alertId?: string; deviceId?: string }) => {
      setAlerts((prev) =>
        prev.filter((a) => {
          if (resolved.id && a.id === resolved.id) return false;
          if (resolved.alertId && a.id === resolved.alertId) return false;
          if (resolved.deviceId && a.deviceId === resolved.deviceId && a.type === 'DEVICE_OFFLINE') return false;
          return true;
        })
      );
    });

    realtime.on('alert:updated', (updated: DashboardAlert) => {
      setAlerts((prev) =>
        prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
      );
    });

    return () => {
      realtime.disconnect();
    };
  }, [token]);

  // Calculated Device KPI statistics
  const deviceStats = useMemo(() => {
    return {
      total: devices.length,
      online: devices.filter((d) => d.status === 'ONLINE').length,
      warning: devices.filter((d) => d.status === 'WARNING').length,
      offline: devices.filter((d) => d.status === 'OFFLINE').length
    };
  }, [devices]);

  if (loading) {
    return (
      <section className="page">
        <div className="empty-state">Đang tải trang tổng quan...</div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="page">
        <div className="empty-state error-state">
          Không thể tải trang tổng quan.
          <span>{error}</span>
        </div>
      </section>
    );
  }

  const thresholds = readSmartBinThresholds();
  const compartments = getCompartments(data.bins);
  const totalCompartments = compartments.length;
  const activeCompartments = compartments.filter((compartment) => compartment.bin && compartment.bin.status !== 'OFFLINE').length;
  const needsCollection = compartments.filter((compartment) => compartment.bin && getFillLevelStatus(compartment.bin.currentFillLevel, thresholds) === 'FULL');
  const lastUpdatedAt = compartments.reduce<string | null>(
    (latest, compartment) => (!compartment.bin?.lastSeen ? latest : !latest || compartment.bin.lastSeen > latest ? compartment.bin.lastSeen : latest),
    null
  );
  const lastUpdatedLabel = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString('vi-VN') : 'Chưa có dữ liệu';

  return (
    <section className="page dashboard-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">VẬN HÀNH TRỰC TIẾP</div>
          <h1>Tổng quan hệ thống</h1>
          <p>Theo dõi mức độ đầy và trạng thái các thùng rác theo thời gian thực.</p>
        </div>
        <div className={`realtime-indicator ${connected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot" /> {connected ? 'Realtime: Đã kết nối' : 'Realtime: Mất kết nối'}
        </div>
      </div>

      {/* Summary KPI Grid */}
      <div className="summary-grid overview-grid">
        <SummaryCard label="Tổng số ngăn" value={totalCompartments} />
        <SummaryCard label="Đang hoạt động" value={activeCompartments} tone="normal" />
        <SummaryCard label="Cần thu gom" value={needsCollection.length} tone="critical" />
        <SummaryCard label="Cập nhật gần nhất" value={lastUpdatedLabel} />
      </div>

      {/* Waste Compartments Grid */}
      <div className="system-heading">
        <h2>Hệ thống SmartBin</h2>
        <p>Một hệ thống duy nhất gồm ba ngăn phân loại rác, mỗi ngăn có cảm biến siêu âm riêng đo mức độ đầy.</p>
      </div>

      <div className="waste-grid">
        {compartments.map((compartment) => (
          <WasteCard key={compartment.key} label={compartment.label} bin={compartment.bin} />
        ))}
      </div>

      {/* Device Health Summary Section */}
      <section className="device-status-section">
        <div className="section-heading dashboard-section-header">
          <div>
            <h2>Tình trạng thiết bị</h2>
            <p className="section-subtext">Giám sát sức khỏe và kết nối của 4 thiết bị phần cứng IoT theo thời gian thực.</p>
          </div>
          <button type="button" className="text-link-button" onClick={() => navigate('/devices')}>
            Xem tất cả thiết bị →
          </button>
        </div>

        {/* Device KPI Summary Cards */}
        <div className="summary-grid device-dashboard-kpi">
          <div className="summary-card">
            <span>Tổng thiết bị</span>
            <strong>{deviceStats.total}</strong>
          </div>
          <div className="summary-card">
            <span>Đang hoạt động</span>
            <strong className="text-success">{deviceStats.online}</strong>
          </div>
          <div className="summary-card warning">
            <span>Cần kiểm tra</span>
            <strong className="text-warning">{deviceStats.warning}</strong>
          </div>
          <div className="summary-card critical">
            <span>Mất kết nối</span>
            <strong className="text-danger">{deviceStats.offline}</strong>
          </div>
        </div>

        {/* Device Cards Grid */}
        {deviceLoading && devices.length === 0 ? (
          <div className="device-health-loading">Đang tải tình trạng thiết bị...</div>
        ) : deviceError && devices.length === 0 ? (
          <div className="device-health-error">Không thể tải tình trạng thiết bị.</div>
        ) : devices.length === 0 ? (
          <div className="device-health-loading">Không có thiết bị.</div>
        ) : (
          <div className="dashboard-device-grid">
            {devices.map((device) => (
              <div
                key={device.id}
                className={`dashboard-device-card dashboard-device-card--${device.status.toLowerCase()}`}
                onClick={() => navigate('/devices')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    navigate('/devices');
                  }
                }}
                title={`Xem chi tiết ${device.deviceName}`}
              >
                <div className="dashboard-device-card__head">
                  <div className="dashboard-device-card__icon">
                    {getDeviceIcon(device.deviceType)}
                  </div>
                  <div className="dashboard-device-card__titles">
                    <h3 className="dashboard-device-card__name">
                      {DEVICE_TYPE_LABELS[device.deviceType] || device.deviceName}
                    </h3>
                    <span className="device-id-code">{device.deviceId}</span>
                  </div>
                </div>

                <div className="dashboard-device-card__status">
                  {getStatusBadge(device.status)}
                </div>

                <div className="dashboard-device-card__meta">
                  <span>Hoạt động cuối:</span>
                  <strong title={formatDateTime(device.lastSeen)}>
                    {secondsAgoLabel(device.lastSeen)}
                  </strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Collection Alerts & Realtime System Alerts */}
      <section className={`collection-alert-section ${needsCollection.length > 0 || alerts.length > 0 ? 'has-alerts' : 'no-alerts'}`}>
        <div className="section-heading dashboard-section-header">
          <div>
            <h2>Cảnh báo hệ thống & Thu gom</h2>
            <p className="section-subtext">Cảnh báo thu gom thùng rác và tình trạng thiết bị mất kết nối.</p>
          </div>
          <button type="button" className="text-link-button" onClick={() => navigate('/alerts')}>
            Xem tất cả cảnh báo →
          </button>
        </div>

        {needsCollection.length === 0 && alerts.length === 0 ? (
          <p className="empty-copy">Hiện tại không có ngăn nào cần thu gom và không có cảnh báo hệ thống.</p>
        ) : (
          <div className="dashboard-alerts-container">
            {needsCollection.length > 0 && (
              <ul className="collection-alert-list">
                {needsCollection.map((compartment) => (
                  <li key={compartment.key}>
                    ⚠ {compartment.label} đã đạt {compartment.bin!.currentFillLevel}%. Đề nghị nhân viên thu gom kiểm tra và xử lý.
                  </li>
                ))}
              </ul>
            )}

            {alerts.length > 0 && (
              <div className="alert-list">
                {alerts.slice(0, 5).map((alert) => (
                  <article className="alert-row" key={alert.id}>
                    <span className={`badge badge-${badge(alert.severity)}`}>
                      {translateAlertSeverity(alert.severity)}
                    </span>
                    <strong>{alert.bin?.binCode ?? (alert.deviceId || 'Hệ thống')}</strong>
                    <span>{alert.message}</span>
                    <small>{ago(alert.createdAt)}</small>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </section>
  );
}

function SummaryCard({ label, value, tone = '' }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={`summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function secondsAgoLabel(value: string | null): string {
  if (!value) return 'Chưa có dữ liệu';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return 'Vừa xong';
  if (seconds < 60) return `Cập nhật ${seconds} giây trước`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Cập nhật ${minutes} phút trước`;
  return `Cập nhật lúc ${new Date(value).toLocaleTimeString('vi-VN')}`;
}

function WasteCard({ label, bin }: { label: string; bin: (Bin & { distanceCm: number | null }) | undefined }) {
  if (!bin) return <article className="waste-card waste-card-empty"><h3>{label}</h3><p className="empty-copy">Chưa có thùng rác nào được gán cho loại này.</p></article>;
  const thresholds = readSmartBinThresholds();
  const status = getFillLevelStatus(bin.currentFillLevel, thresholds);
  const tone = FILL_LEVEL_STATUS_TONE[status];
  return (
    <article className={`waste-card waste-tone-${tone}`}>
      <div className="waste-card-header"><h3>{label}</h3></div>
      <strong className="waste-percentage">{bin.currentFillLevel}%</strong>
      <div className="waste-progress-track" role="progressbar" aria-valuenow={bin.currentFillLevel} aria-valuemin={0} aria-valuemax={100}>
        <span className={`waste-progress-fill waste-tone-${tone}`} style={{ width: `${bin.currentFillLevel}%` }} />
      </div>
      <div className="waste-card-footer">
        <span className={`badge badge-${tone}`}>{FILL_LEVEL_STATUS_LABEL[status]}</span>
        <small>{secondsAgoLabel(bin.lastSeen)}</small>
      </div>
    </article>
  );
}

export function SensorHistoryPage() {
  const { token } = useAuth();
  const [bins, setBins] = useState<Bin[]>([]);
  const [readings, setReadings] = useState<DashboardData['recentSensorReadings']>([]);
  const [category, setCategory] = useState<'ALL' | WasteCategoryKey>('ALL');
  const [range, setRange] = useState<'ALL' | 'TODAY' | '7D' | '30D'>('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getData<{ bins: Bin[] }>('/api/bins', token!).then((result) => setBins(result.bins));
  }, [token]);

  const compartments = useMemo(() => getCompartments(bins), [bins]);
  const categoryByBinCode = useMemo(() => new Map(compartments.filter((c) => c.bin).map((c) => [c.bin!.binCode, c.label])), [compartments]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (category !== 'ALL') {
      const bin = compartments.find((c) => c.key === category)?.bin;
      if (bin) params.set('binCode', bin.binCode);
    }
    const days = range === 'TODAY' ? 0 : range === '7D' ? 7 : range === '30D' ? 30 : null;
    if (days !== null) {
      const from = new Date();
      from.setDate(from.getDate() - days);
      from.setHours(0, 0, 0, 0);
      params.set('from', from.toISOString());
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    getData<{ readings: DashboardData['recentSensorReadings'] }>(`/api/dashboard/sensor-readings${query}`, token!)
      .then((result) => setReadings(result.readings))
      .finally(() => setLoading(false));
  }, [token, category, range, compartments]);

  const visibleReadings = readings.filter((reading) => categoryByBinCode.has(reading.bin.binCode));

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">LỊCH SỬ DỮ LIỆU CẢM BIẾN</div>
          <h1>Lịch sử cảm biến</h1>
          <p>Lịch sử dữ liệu từ các cảm biến siêu âm của hệ thống SmartBin.</p>
        </div>
      </div>
      <div className="filter-bar">
        <label>
          Loại rác
          <select value={category} onChange={(event) => { setLoading(true); setCategory(event.target.value as 'ALL' | WasteCategoryKey); }}>
            <option value="ALL">Tất cả</option>
            {WASTE_CATEGORY_ORDER.map((key) => (
              <option key={key} value={key}>{WASTE_CATEGORY_LABEL[key]}</option>
            ))}
          </select>
        </label>
        <label>
          Khoảng thời gian
          <select value={range} onChange={(event) => { setLoading(true); setRange(event.target.value as 'ALL' | 'TODAY' | '7D' | '30D'); }}>
            <option value="ALL">Tất cả</option>
            <option value="TODAY">Hôm nay</option>
            <option value="7D">7 ngày gần nhất</option>
            <option value="30D">30 ngày gần nhất</option>
          </select>
        </label>
      </div>
      {loading ? (
        <div className="empty-state">Đang tải lịch sử cảm biến...</div>
      ) : visibleReadings.length === 0 ? (
        <div className="empty-state">Không tìm thấy dữ liệu cảm biến nào.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Loại rác</th>
                <th>Mức độ đầy</th>
                <th>Khoảng cách đo được</th>
                <th>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {visibleReadings.map((reading) => (
                <tr key={reading.id}>
                  <td><strong>{categoryByBinCode.get(reading.bin.binCode) ?? reading.bin.name}</strong></td>
                  <td>{reading.fillLevel}%</td>
                  <td>{reading.distance} cm</td>
                  <td>{ago(reading.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AlertsPage() {
  const { token } = useAuth();
  const [alerts, setAlerts] = useState<DashboardData['alerts']>([]);

  useEffect(() => {
    getData<{ alerts: DashboardData['alerts'] }>('/api/dashboard/alerts', token!).then((data) => setAlerts(data.alerts));
  }, [token]);

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">TÍN HIỆU VẬN HÀNH</div>
          <h1>Cảnh báo</h1>
          <p>Cảnh báo mức độ đầy và tín hiệu nghiêm trọng từ thiết bị.</p>
        </div>
      </div>
      {alerts.length === 0 ? (
        <div className="empty-state">Không tìm thấy cảnh báo nào.</div>
      ) : (
        <div className="alert-list">
          {alerts.map((alert) => (
            <article className="alert-row" key={alert.id}>
              <span className={`badge badge-${badge(alert.severity)}`}>{translateAlertSeverity(alert.severity)}</span>
              <strong>{alert.bin?.binCode ?? (alert.deviceId || 'Hệ thống')}</strong>
              <span>{alert.message}</span>
              <small>{ago(alert.createdAt)}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

