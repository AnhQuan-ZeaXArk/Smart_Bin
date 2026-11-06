import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './auth-context';
import { useRealtime } from './realtime-store';
import { translateAlertSeverity, translateBinStatus, translateFillCategory } from './i18n-labels';
import type { Bin, FillCategory } from './bins';
import { getCompartments, WASTE_CATEGORY_LABEL, WASTE_CATEGORY_ORDER, type WasteCategoryKey } from './waste-category';
import {
  IconCpu,
  IconCheckCircle,
  IconAlertTriangle,
  IconXCircle,
  IconActivity,
  IconRefresh
} from './icons';

import { apiUrl } from './api-config';
import { RealDeviceCard } from './real-device-card';

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
  resolvedAt?: string | null;
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
  devices?: unknown[];
  alerts: DashboardAlert[];
};

async function getData<T>(path: string, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, { headers });
  } catch {
    throw new Error(`Không thể kết nối đến máy chủ API (${apiUrl}). Vui lòng kiểm tra trạng thái máy chủ Render.`);
  }
  if (!response.ok) {
    throw new Error(`Máy chủ phản hồi lỗi (${response.status}): ${response.statusText || 'Không thể tải dữ liệu.'}`);
  }
  return response.json() as Promise<T>;
}


function ago(value: string | null) {
  return value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có dữ liệu';
}

function badge(value: string) {
  return value.toLowerCase().replace('_', '-');
}

function mergeTelemetry(data: DashboardData, event: RealtimeTelemetry): DashboardData {
  const bins = data.bins.map((bin) =>
    bin.binCode === event.binCode
      ? {
          ...bin,
          currentFillLevel: event.fillLevel,
          fillCategory: event.fillCategory,
          distanceCm: event.distanceCm,
          lastSeen: event.timestamp
        }
      : bin
  );
  const summary = {
    ...data.summary,
    normal: bins.filter((bin) => bin.fillCategory === 'NORMAL').length,
    warning: bins.filter((bin) => bin.fillCategory === 'MONITOR' || bin.fillCategory === 'NEARLY_FULL').length,
    full: bins.filter((bin) => bin.fillCategory === 'CRITICAL').length,
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
  const { socket: realtime, connected } = useRealtime();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  function refreshDashboard() {
    setError('');
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
  }

  // Load Dashboard summary data
  useEffect(() => {
    let active = true;

    getData<DashboardData>('/api/dashboard/summary', token)
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Không thể tải trang tổng quan.');
      })
      .finally(() => {
        if (active) setLoading(false);
        if (active) setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [token, refreshKey]);

  // Realtime subscriptions use the AppShell connection.
  useEffect(() => {
    if (!realtime) return;

    const onTelemetry = (event: RealtimeTelemetry) => {
      setData((current) => (current ? mergeTelemetry(current, event) : current));
    };

    realtime.on('bin:telemetry', onTelemetry);

    return () => {
      realtime.off('bin:telemetry', onTelemetry);
    };
  }, [realtime]);

  if (loading) {
    return (
      <section className="page dashboard-page">
        <div className="page-heading"><div><div className="eyebrow">VẬN HÀNH TRỰC TIẾP</div><h1>Tổng quan hệ thống</h1><p>Đang tải dữ liệu giám sát từ hệ thống.</p></div></div>
        <div className="skeleton-grid dashboard-skeleton-kpis"><div /><div /><div /><div /><div /></div>
        <div className="skeleton-grid"><div /><div /><div /></div>
        <div className="skeleton-list"><div /><div /><div /></div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="page">
        <div className="state-panel state-panel--error">
          <IconActivity />
          <strong>Không thể tải trang tổng quan</strong>
          <span>{error}</span>
          <button className="button-secondary" type="button" onClick={refreshDashboard}>Thử lại</button>
        </div>
      </section>
    );
  }

  const compartments = getCompartments(data.bins);
  const needsAttentionCount = data.bins.filter((bin) => bin.fillCategory === 'MONITOR').length;
  const nearlyFullCount = data.bins.filter((bin) => bin.fillCategory === 'NEARLY_FULL' || bin.fillCategory === 'CRITICAL').length;

  return (
    <section className="page dashboard-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">VẬN HÀNH TRỰC TIẾP</div>
          <h1>Tổng quan hệ thống</h1>
          <p>Giám sát tình trạng thùng rác và thiết bị theo thời gian thực.</p>
        </div>
        <div className="dashboard-heading-actions">
          <div className={`realtime-indicator ${connected ? 'connected' : 'disconnected'}`}><span className="status-dot" />{connected ? 'Realtime: Đã kết nối' : 'Realtime: Mất kết nối'}</div>
          <button className={`button-primary${refreshing ? ' is-refreshing' : ''}`} type="button" onClick={refreshDashboard} disabled={refreshing}><IconRefresh />{refreshing ? 'Đang làm mới' : 'Làm mới dữ liệu'}</button>
        </div>
      </div>

      {/* Summary KPI Grid */}
      <div className="summary-grid overview-grid">
        <SummaryCard label="Tổng số thùng" value={data.summary.total} icon={<IconActivity />} />
        <SummaryCard label="Bình thường" value={data.summary.normal} tone="normal" icon={<IconCheckCircle />} />
        <SummaryCard label="Cần chú ý" value={needsAttentionCount} tone="warning" icon={<IconAlertTriangle />} />
        <SummaryCard label="Gần đầy / Đầy" value={nearlyFullCount} tone="critical" icon={<IconXCircle />} />
        <SummaryCard label="Thiết bị offline" value={data.summary.offline} tone="offline" icon={<IconCpu />} />
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
            <p className="section-subtext">Giám sát sức khỏe và kết nối thiết bị phần cứng IoT theo thời gian thực.</p>
          </div>
          <button type="button" className="text-link-button" onClick={() => navigate('/devices')}>
            Xem tất cả thiết bị →
          </button>
        </div>

        {/* Real Hardware Raspberry Pi 5 Telemetry Card */}
        <RealDeviceCard refreshTrigger={refreshKey} />
      </section>
    </section>
  );
}

function SummaryCard({ label, value, tone = '', icon }: { label: string; value: number | string; tone?: string; icon?: ReactNode }) {
  return (
    <div className={`summary-card ${tone}`}>
      {icon && <span className="summary-card__icon">{icon}</span>}
      <span>{label}</span>
      <strong><span className="summary-card__value" key={String(value)}>{value}</span></strong>
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
  const tone = bin.fillCategory === 'CRITICAL' ? 'critical' : bin.fillCategory === 'NEARLY_FULL' ? 'nearly_full' : bin.fillCategory === 'MONITOR' ? 'monitor' : 'normal';
  return (
    <article className={`waste-card waste-tone-${tone}`}>
      <div className="waste-card-header"><div className="waste-card-identity"><h3>{label}</h3><span className="device-id-code">{bin.binCode}</span></div><span className={`status-badge status-badge--${bin.status.toLowerCase()}`}>{translateBinStatus(bin.status)}</span></div>
      <strong className="waste-percentage">{bin.currentFillLevel}%</strong>
      <div className="waste-progress-track" role="progressbar" aria-valuenow={bin.currentFillLevel} aria-valuemin={0} aria-valuemax={100}>
        <span className={`waste-progress-fill waste-tone-${tone}`} style={{ width: `${bin.currentFillLevel}%` }} />
      </div>
      <div className="waste-card-footer">
        <span className={`badge badge-${tone}`}>{translateFillCategory(bin.fillCategory)}</span>
        <small>{secondsAgoLabel(bin.lastSeen)}</small>
      </div>
      <dl className="waste-card-facts"><div><dt>Khoảng cách</dt><dd>{bin.distanceCm === null ? 'Chưa có dữ liệu' : `${bin.distanceCm} cm`}</dd></div><div><dt>Dung tích</dt><dd>{bin.capacity.toLocaleString('vi-VN')} L</dd></div></dl>
    </article>
  );
}

export function SensorHistoryPage() {
  const { token } = useAuth();
  const [bins, setBins] = useState<Bin[]>([]);
  const [binsLoaded, setBinsLoaded] = useState(false);
  const [readings, setReadings] = useState<DashboardData['recentSensorReadings']>([]);
  const [category, setCategory] = useState<'ALL' | WasteCategoryKey>('ALL');
  const [range, setRange] = useState<'ALL' | 'TODAY' | '7D' | '30D'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    getData<{ bins: Bin[] }>('/api/bins', token)
      .then((result) => { if (active) setBins(result.bins); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Không thể tải danh sách thùng.'); })
      .finally(() => { if (active) setBinsLoaded(true); });
    return () => { active = false; };
  }, [token, refreshKey]);

  const compartments = useMemo(() => getCompartments(bins), [bins]);
  const categoryByBinCode = useMemo(() => new Map(compartments.filter((c) => c.bin).map((c) => [c.bin!.binCode, c.label])), [compartments]);

  useEffect(() => {
    if (!binsLoaded || error) return;
    let active = true;
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
    getData<{ readings: DashboardData['recentSensorReadings'] }>(`/api/dashboard/sensor-readings${query}`, token)
      .then((result) => { if (active) setReadings(result.readings); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Không thể tải lịch sử cảm biến.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, binsLoaded, category, range, compartments, error]);

  const visibleReadings = readings.filter((reading) => category === 'ALL' || categoryByBinCode.has(reading.bin.binCode));
  const refreshHistory = () => { setLoading(true); setError(''); setRefreshKey((value) => value + 1); };

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">LỊCH SỬ DỮ LIỆU CẢM BIẾN</div>
          <h1>Lịch sử cảm biến</h1>
          <p>Lịch sử dữ liệu từ các cảm biến siêu âm của hệ thống SmartBin.</p>
        </div>
        <button className="button-secondary refresh-button" type="button" onClick={refreshHistory} disabled={loading}><IconRefresh /> Làm mới</button>
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
        <div className="skeleton-table" aria-label="Đang tải lịch sử cảm biến"><div /><div /><div /><div /></div>
      ) : error ? (
        <div className="state-panel state-panel--error"><IconActivity /><strong>Không thể tải lịch sử cảm biến</strong><span>{error}</span><button className="button-secondary" type="button" onClick={refreshHistory}>Thử lại</button></div>
      ) : visibleReadings.length === 0 ? (
        <div className="state-panel"><IconActivity /><strong>Chưa có dữ liệu cảm biến</strong><span>Không tìm thấy bản ghi phù hợp với bộ lọc hiện tại.</span></div>
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
  const { socket } = useRealtime();
  const [alerts, setAlerts] = useState<DashboardData['alerts']>([]);
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'>('ALL');
  const [resolutionFilter, setResolutionFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [recentAlertIds, setRecentAlertIds] = useState<Set<string>>(() => new Set());
  const seenAlertIds = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    getData<{ alerts: DashboardData['alerts'] }>('/api/dashboard/alerts', token)
      .then((data) => {
        if (active) {
          for (const alert of data.alerts) seenAlertIds.current.add(alert.id);
          setAlerts((current) => {
            const currentIds = new Set(current.map((alert) => alert.id));
            return [...current, ...data.alerts.filter((alert) => !currentIds.has(alert.id))];
          });
        }
      })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Không thể tải cảnh báo.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, refreshKey]);

  useEffect(() => {
    if (!socket) return;
    const onCreated = (alert: DashboardAlert) => {
      if (seenAlertIds.current.has(alert.id)) return;
      seenAlertIds.current.add(alert.id);
      setRecentAlertIds((current) => new Set(current).add(alert.id));
      setAlerts((current) => current.some((item) => item.id === alert.id) ? current : [alert, ...current]);
    };
    const onUpdated = (alert: DashboardAlert) => setAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, ...alert } : item));
    const onResolved = (event: { id?: string; alertId?: string; deviceId?: string; resolvedAt?: string }) => {
      setAlerts((current) => current.map((item) => {
        const matchesId = (event.id && item.id === event.id) || (event.alertId && item.id === event.alertId);
        const matchesDevice = event.deviceId && item.deviceId === event.deviceId && item.type === 'DEVICE_OFFLINE';
        return matchesId || matchesDevice ? { ...item, isResolved: true, resolvedAt: event.resolvedAt ?? null } : item;
      }));
    };
    socket.on('alert:created', onCreated);
    socket.on('alert:updated', onUpdated);
    socket.on('alert:resolved', onResolved);
    return () => {
      socket.off('alert:created', onCreated);
      socket.off('alert:updated', onUpdated);
      socket.off('alert:resolved', onResolved);
    };
  }, [socket]);

  const visibleAlerts = useMemo(() => alerts.filter((alert) => {
    const matchesSeverity = filter === 'ALL' || alert.severity === filter;
    const matchesResolution = resolutionFilter === 'ALL' || (resolutionFilter === 'RESOLVED' ? Boolean(alert.isResolved) : !alert.isResolved);
    return matchesSeverity && matchesResolution;
  }), [alerts, filter, resolutionFilter]);
  const refreshAlerts = () => { setLoading(true); setError(''); setRefreshKey((value) => value + 1); };

  return (
    <section className="page alerts-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">EVENT MONITOR</div>
          <h1>Trung tâm cảnh báo</h1>
          <p>Theo dõi sự kiện hệ thống và trạng thái xử lý theo thời gian thực.</p>
        </div>
        <button className="button-secondary refresh-button" type="button" onClick={refreshAlerts} disabled={loading}><IconRefresh /> Làm mới</button>
      </div>
      <div className="alert-filter-tabs" role="tablist" aria-label="Lọc theo mức độ cảnh báo">
        {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const).map((severity) => <button key={severity} type="button" role="tab" aria-selected={filter === severity} className={filter === severity ? 'active' : ''} onClick={() => setFilter(severity)}>{severity === 'ALL' ? 'Tất cả' : translateAlertSeverity(severity)}<span>{severity === 'ALL' ? alerts.length : alerts.filter((alert) => alert.severity === severity).length}</span></button>)}
      </div>
      <div className="filter-bar alert-resolution-filter"><label>Trạng thái xử lý<select value={resolutionFilter} onChange={(event) => setResolutionFilter(event.target.value as 'ALL' | 'OPEN' | 'RESOLVED')}><option value="ALL">Tất cả</option><option value="OPEN">Chưa xử lý</option><option value="RESOLVED">Đã xử lý</option></select></label></div>
      {loading ? <div className="skeleton-list"><div /><div /><div /></div>
        : error ? <div className="state-panel state-panel--error"><IconActivity /><strong>Không thể tải cảnh báo</strong><span>{error}</span><button className="button-secondary" type="button" onClick={refreshAlerts}>Thử lại</button></div>
          : visibleAlerts.length === 0 ? <div className="state-panel"><IconActivity /><strong>{alerts.length ? 'Không có cảnh báo trong nhóm này' : 'Chưa có cảnh báo'}</strong><span>{alerts.length ? 'Chọn bộ lọc khác để xem sự kiện.' : 'Các sự kiện vận hành sẽ hiển thị tại đây khi được ghi nhận.'}</span></div>
            : (
        <div className="alert-list alert-list--monitor">
          {visibleAlerts.map((alert) => (
            <article className={`alert-row alert-row--${alert.severity.toLowerCase()}${alert.isResolved ? ' alert-row--resolved' : ''}${recentAlertIds.has(alert.id) ? ' alert-row--realtime-new' : ''}`} key={alert.id} onAnimationEnd={() => {
              if (recentAlertIds.has(alert.id)) setRecentAlertIds((current) => {
                const next = new Set(current);
                next.delete(alert.id);
                return next;
              });
            }}>
              <span className={`badge badge-${badge(alert.severity)}`}>{translateAlertSeverity(alert.severity)}</span>
              <strong>{alert.bin?.binCode ?? (alert.deviceId || 'Hệ thống')}</strong>
              <span>{alert.message}</span>
              <small>{ago(alert.createdAt)}</small>
              <span className={`alert-resolution ${alert.isResolved ? 'is-resolved' : ''}`}>{alert.isResolved ? 'Đã xử lý' : 'Chưa xử lý'}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

