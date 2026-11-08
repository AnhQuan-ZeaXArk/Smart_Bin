import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './auth-context';
import { useRealtime } from './realtime-store';
import { translateAlertSeverity } from './i18n-labels';
import type { Bin, FillCategory } from './bins';
import { getCompartments, WASTE_CATEGORY_LABEL, WASTE_CATEGORY_ORDER, type WasteCategoryKey } from './waste-category';
import {
  IconCpu,
  IconCheckCircle,
  IconXCircle,
  IconActivity,
  IconRefresh
} from './icons';

import { apiUrl } from './api-config';
import { RealDeviceCard } from './real-device-card';
import {
  parseTimestamp,
  shouldDropIncoming,
  isRaspberryPiDevice
} from './device-utils';
import {
  computeBinViewModel,
  mergeDeviceHeartbeatToBins,
  groupBinsByStation
} from './bin-view-model';

type RealtimeTelemetry = {
  binCode: string;
  fillLevel: number | null;
  fillCategory: FillCategory;
  distanceCm: number | null;
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

type DashboardBin = Bin & {
  distanceCm: number | null;
  isReal?: boolean;
};

type DashboardData = {
  summary: Summary;
  bins: DashboardBin[];
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
  const bins = data.bins.map((bin) => {
    if (bin.binCode !== event.binCode) return bin;

    // RULE 2: Dữ liệu mô phỏng bin:telemetry TUYỆT ĐỐI KHÔNG ĐƯỢC ghi đè dữ liệu cảm biến thực tế
    if (bin.isReal) {
      return bin;
    }

    const currentTs = parseTimestamp(bin.lastSeen);
    const incomingTs = parseTimestamp(event.timestamp);
    if (shouldDropIncoming(currentTs, incomingTs)) {
      return bin;
    }

    return {
      ...bin,
      currentFillLevel: event.fillLevel,
      fillCategory: event.fillCategory,
      distanceCm: event.distanceCm,
      lastSeen: event.timestamp,
      status: (event.fillLevel !== null ? 'ONLINE' : 'OFFLINE') as any
    };
  });

  const onlineNumericBins = bins.filter(
    (bin) => typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel) && bin.status !== 'OFFLINE'
  );

  const summary = {
    ...data.summary,
    normal: onlineNumericBins.filter((bin) => bin.fillCategory === 'NORMAL').length,
    warning: onlineNumericBins.filter((bin) => bin.fillCategory === 'MONITOR' || bin.fillCategory === 'NEARLY_FULL').length,
    full: onlineNumericBins.filter((bin) => bin.fillCategory === 'CRITICAL').length,
    offline: bins.length - onlineNumericBins.length
  };

  return {
    ...data,
    bins,
    summary,
    recentSensorReadings: typeof event.fillLevel === 'number' ? [
      {
        id: `live-${event.binCode}-${event.timestamp}`,
        fillLevel: event.fillLevel,
        distance: event.distanceCm ?? 0,
        timestamp: event.timestamp,
        bin: { binCode: event.binCode, name: bins.find((bin) => bin.binCode === event.binCode)?.name ?? event.binCode }
      },
      ...data.recentSensorReadings
    ].slice(0, 8) : data.recentSensorReadings
  };
}

function mergeDeviceHeartbeat(data: DashboardData, hb: any): DashboardData {
  if (!hb) return data;

  // Nếu sự kiện dành cho thiết bị ngoại vi khác (Camera, MQTT), chỉ cập nhật devices, KHÔNG ghi đè ngăn rác
  if (hb.deviceId && !isRaspberryPiDevice(hb.deviceId, hb.deviceType)) {
    if (data.devices && Array.isArray(data.devices)) {
      const updatedDevices = data.devices.map((d: any) =>
        d.deviceId === hb.deviceId || d.id === hb.id ? { ...d, ...hb } : d
      );
      return { ...data, devices: updatedDevices };
    }
    return data;
  }

  const bins = mergeDeviceHeartbeatToBins(data.bins, hb);

  const onlineNumericBins = bins.filter(
    (bin) => typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel) && bin.status !== 'OFFLINE'
  );

  const summary = {
    ...data.summary,
    normal: onlineNumericBins.filter((bin) => bin.fillCategory === 'NORMAL').length,
    warning: onlineNumericBins.filter((bin) => bin.fillCategory === 'MONITOR' || bin.fillCategory === 'NEARLY_FULL').length,
    full: onlineNumericBins.filter((bin) => bin.fillCategory === 'CRITICAL').length,
    offline: bins.length - onlineNumericBins.length
  };

  let devices = data.devices;
  if (devices && Array.isArray(devices)) {
    devices = devices.map((d: any) =>
      isRaspberryPiDevice(d.deviceId, d.deviceType)
        ? { ...d, ...hb, status: hb.status || d.status }
        : d
    );
  }

  return {
    ...data,
    bins,
    summary,
    devices
  };
}

interface StationOption {
  id: string;
  code: string;
  name: string;
  status: string;
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
  const [clock, setClock] = useState(() => Date.now());
  const [stations, setStations] = useState<StationOption[]>([]);
  const [selectedStationCode, setSelectedStationCode] = useState<string>('');
  const [collapsedStations, setCollapsedStations] = useState<Record<string, boolean>>({});

  const toggleStationCollapse = (code: string) => {
    setCollapsedStations((prev) => ({
      ...prev,
      [code]: !prev[code]
    }));
  };

  function refreshDashboard() {
    setError('');
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
  }

  // Periodic timer for live age labels and stale data checking
  useEffect(() => {
    const timer = setInterval(() => {
      setClock(Date.now());
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Load danh sách Stations
  useEffect(() => {
    getData<{ stations: StationOption[] }>('/api/stations', token)
      .then((res) => {
        if (res && Array.isArray(res.stations)) {
          setStations(res.stations);
        }
      })
      .catch(() => {});
  }, [token]);

  // Load Dashboard summary data (hỗ trợ lọc theo Station)
  useEffect(() => {
    let active = true;
    const query = selectedStationCode ? `?stationCode=${encodeURIComponent(selectedStationCode)}` : '';

    getData<DashboardData>(`/api/dashboard/summary${query}`, token)
      .then((result) => {
        if (active) {
          const initialized: DashboardData = {
            ...result,
            bins: result.bins.map((b) => ({ ...b, isReal: true }))
          };
          setData(initialized);
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
  }, [token, refreshKey, selectedStationCode]);

  // Realtime subscriptions for both simulator telemetry and real Raspberry Pi heartbeat/status
  useEffect(() => {
    if (!realtime) return;

    if (selectedStationCode) {
      realtime.emit('subscribe:station', { stationCode: selectedStationCode });
    }

    const onTelemetry = (event: RealtimeTelemetry) => {
      setData((current) => (current ? mergeTelemetry(current, event) : current));
    };

    const onHeartbeat = (payload: any) => {
      setData((current) => (current ? mergeDeviceHeartbeat(current, payload) : current));
    };

    const onStatus = (payload: any) => {
      if (!payload) return;
      if (isRaspberryPiDevice(payload.deviceId, payload.deviceType)) {
        setData((current) => (current ? mergeDeviceHeartbeat(current, payload) : current));
      } else {
        setData((current) => {
          if (!current) return current;
          if (current.devices && Array.isArray(current.devices)) {
            const updatedDevices = (current.devices as any[]).map((d) =>
              d.deviceId === payload.deviceId || (d.id && d.id === payload.id) ? { ...d, ...payload } : d
            );
            return { ...current, devices: updatedDevices };
          }
          return current;
        });
      }
    };

    realtime.on('bin:telemetry', onTelemetry);
    realtime.on('device:heartbeat', onHeartbeat);
    realtime.on('device:status', onStatus);

    return () => {
      if (selectedStationCode) {
        realtime.emit('unsubscribe:station', { stationCode: selectedStationCode });
      }
      realtime.off('bin:telemetry', onTelemetry);
      realtime.off('device:heartbeat', onHeartbeat);
      realtime.off('device:status', onStatus);
    };
  }, [realtime, selectedStationCode]);

  const dataBins = data?.bins;

  const stationGroups = useMemo(() => {
    if (!dataBins) return [];
    return groupBinsByStation(dataBins, stations, clock);
  }, [dataBins, stations, clock]);

  const visibleStationGroups = useMemo(() => {
    if (!selectedStationCode) return stationGroups;
    return stationGroups.filter((g) => g.code === selectedStationCode);
  }, [stationGroups, selectedStationCode]);

  const stationFilterOptions = useMemo(() => {
    if (stations && stations.length > 0) return stations;
    return stationGroups.map((g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      status: g.status
    }));
  }, [stations, stationGroups]);

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

  // Round 19: KPI counts computed strictly from real data
  const totalStationsCount = stationGroups.length;
  const totalInstalledBins = stationGroups.reduce((acc, g) => acc + g.installedCount, 0);
  const onlineStationsCount = stationGroups.filter((g) => g.status === 'ONLINE').length;

  // Crucial: bins with installed === false are NOT offline and MUST NOT trigger false offline alerts
  const offlineBinsCount = (data?.bins || []).filter((bin) => {
    if (bin.installed === false) return false;
    const vm = computeBinViewModel(bin, clock);
    return !vm.isValidReading || bin.status === 'OFFLINE';
  }).length;

  const nearlyFullCount = (data?.bins || []).filter((bin) => {
    if (bin.installed === false) return false;
    const vm = computeBinViewModel(bin, clock);
    return vm.isValidReading && (vm.tone === 'nearly_full' || vm.tone === 'critical');
  }).length;

  return (
    <section className="page dashboard-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">VẬN HÀNH TRỰC TIẾP</div>
          <h1>Tổng quan hệ thống</h1>
          <p>Giám sát tình trạng thùng rác và thiết bị theo thời gian thực theo từng trạm thu gom.</p>
        </div>
        <div className="dashboard-heading-actions">
          <select
            className="station-filter-select"
            value={selectedStationCode}
            onChange={(e) => setSelectedStationCode(e.target.value)}
            aria-label="Chọn trạm giám sát"
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #cbd5e1)',
              background: 'var(--card-bg, #ffffff)',
              color: 'var(--text-color, #1e293b)',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            <option value="">Tất cả các trạm (Toàn hệ thống)</option>
            {stationFilterOptions.map((st) => (
              <option key={st.id} value={st.code}>
                {st.name} ({st.code}) - {st.status}
              </option>
            ))}
          </select>
          <div className={`realtime-indicator ${connected ? 'connected' : 'disconnected'}`}><span className="status-dot" />{connected ? 'Realtime: Đã kết nối' : 'Realtime: Mất kết nối'}</div>
          <button className={`button-primary${refreshing ? ' is-refreshing' : ''}`} type="button" onClick={refreshDashboard} disabled={refreshing}><IconRefresh />{refreshing ? 'Đang làm mới' : 'Làm mới dữ liệu'}</button>
        </div>
      </div>

      {/* Summary KPI Grid - Round 19 real-calculated metrics */}
      <div className="summary-grid overview-grid">
        <SummaryCard label="Tổng số trạm" value={totalStationsCount} icon={<IconActivity />} />
        <SummaryCard label="Thùng đã lắp đặt" value={totalInstalledBins} tone="normal" icon={<IconCheckCircle />} />
        <SummaryCard
          label="Trạm trực tuyến"
          value={`${onlineStationsCount}/${totalStationsCount}`}
          tone={onlineStationsCount === totalStationsCount && totalStationsCount > 0 ? 'normal' : 'warning'}
          icon={<IconCheckCircle />}
        />
        <SummaryCard
          label="Gần đầy / Cần thu gom"
          value={nearlyFullCount}
          tone={nearlyFullCount > 0 ? 'critical' : 'normal'}
          icon={<IconXCircle />}
        />
        <SummaryCard
          label="Thiết bị OFFLINE"
          value={offlineBinsCount}
          tone={offlineBinsCount > 0 ? 'critical' : 'offline'}
          icon={<IconCpu />}
        />
      </div>

      {/* Multi-Station Monitoring Sections */}
      <div className="stations-container">
        {visibleStationGroups.map((group) => {
          const isCollapsed = Boolean(collapsedStations[group.code]);
          return (
            <section
              className={`station-section station-section--${group.code.toLowerCase()}`}
              key={group.code}
              data-station-code={group.code}
            >
              <div className="station-header">
                <div className="station-header-main">
                  <div className="station-title-row">
                    <span className="station-code-chip">{group.code}</span>
                    <h2 className="station-name">{group.name}</h2>
                    <span className={`station-status-badge status-badge--${group.status.toLowerCase()}`}>
                      <span className="status-dot" />
                      {group.status === 'ONLINE'
                        ? 'Trực tuyến'
                        : group.status === 'WARNING'
                        ? 'Cảnh báo'
                        : group.status === 'MAINTENANCE'
                        ? 'Bảo trì'
                        : 'Mất kết nối'}
                    </span>
                  </div>

                  <div className="station-meta-row">
                    <span className="station-meta-item">
                      <span className="meta-label">Vị trí:</span>
                      <span className="meta-value">{group.location || 'Chưa thiết lập'}</span>
                    </span>
                    <span className="station-meta-divider">•</span>
                    <span className="station-meta-item">
                      <span className="meta-label">Gateway:</span>
                      <span className="meta-value">{group.gatewayInfo}</span>
                    </span>
                    <span className="station-meta-divider">•</span>
                    <span className="station-meta-item">
                      <span className="meta-label">Controller:</span>
                      <span className="meta-value">{group.controllerInfo}</span>
                    </span>
                  </div>
                </div>

                <div className="station-header-right">
                  <div className="station-stats-pills">
                    <span className="station-stat-pill" title="Số lượng thùng rác đã kích hoạt trên tổng loại thùng">
                      <span className="stat-label">Đã lắp:</span>
                      <strong className="stat-value">
                        {group.installedCount}/{group.totalBinsCount} thùng
                      </strong>
                    </span>
                    <span className="station-stat-pill" title="Mức độ đầy trung bình của các thùng đang hoạt động">
                      <span className="stat-label">Mức đầy TB:</span>
                      <strong className="stat-value">
                        {group.averageFillPct !== null ? `${group.averageFillPct}%` : '—'}
                      </strong>
                    </span>
                    <span className="station-stat-pill" title="Thời gian nhận dữ liệu cảm biến gần nhất">
                      <span className="stat-label">Cập nhật:</span>
                      <strong className="stat-value">{group.lastSeenText}</strong>
                    </span>
                  </div>

                  <button
                    type="button"
                    className="station-collapse-btn"
                    onClick={() => toggleStationCollapse(group.code)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? 'Mở rộng' : 'Thu gọn'} ${group.name}`}
                  >
                    {isCollapsed ? 'Mở rộng ▼' : 'Thu gọn ▲'}
                  </button>
                </div>
              </div>

              {!isCollapsed && (
                <div className="waste-grid">
                  {group.compartments.map((compartment) => (
                    <WasteCard
                      key={`${group.code}-${compartment.key}`}
                      label={compartment.label}
                      bin={compartment.bin}
                      stationCode={group.code}
                      now={clock}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {visibleStationGroups.length === 0 && (
          <div className="empty-state">
            <p>Không tìm thấy trạm thu gom rác nào phù hợp với bộ lọc hiện tại.</p>
          </div>
        )}
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

export function WasteCard({
  label,
  bin,
  stationCode,
  now
}: {
  label: string;
  bin: (Bin & { distanceCm: number | null }) | undefined;
  stationCode?: string;
  now?: number;
}) {
  if (!bin) {
    return (
      <article className="waste-card waste-card-empty">
        <h3>{label}</h3>
        <p className="empty-copy">Chưa có thùng rác nào được gán cho loại này.</p>
      </article>
    );
  }

  const vm = computeBinViewModel(bin, now);

  return (
    <article
      className={`waste-card waste-tone-${vm.tone} ${vm.isUninstalled ? 'waste-card--uninstalled' : ''}`}
      data-station={stationCode || (bin as any).stationCode || (bin as any).station?.code}
      data-installed={bin.installed !== false}
    >
      <div className="waste-card-header">
        <div className="waste-card-identity">
          <h3>{label}</h3>
          <span className="device-id-code">{bin.binCode}</span>
        </div>
        <span
          className={`status-badge status-badge--${
            vm.isUninstalled ? 'uninstalled' : !vm.isValidReading ? 'offline' : bin.status.toLowerCase()
          }`}
        >
          {vm.statusBadgeText}
        </span>
      </div>

      <strong className={`waste-percentage ${!vm.isValidReading ? 'text-unavailable' : ''}`}>
        {vm.displayPercentage}
      </strong>

      <div
        className={`waste-progress-track ${!vm.isValidReading ? 'is-unavailable' : ''}`}
        role="progressbar"
        aria-valuenow={vm.isValidReading ? vm.fillPct : 0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={`waste-progress-fill ${vm.isValidReading ? `waste-tone-${vm.tone}` : 'is-unavailable'}`}
          style={{ width: vm.progressWidth }}
        />
      </div>

      <div className="waste-card-footer">
        <span className={`badge badge-${vm.isUninstalled ? 'uninstalled' : vm.tone}`}>
          {vm.fillCategoryBadgeText}
        </span>
        <small>{vm.lastSeenText}</small>
      </div>

      {vm.isUninstalled ? (
        <div className="waste-card-uninstalled-note">
          <span>Ngăn này chưa gắn cảm biến đo mức đầy. Sẵn sàng cấu hình mở rộng phần cứng.</span>
        </div>
      ) : vm.hasDistance ? (
        <dl className="waste-card-facts">
          <div>
            <dt>Khoảng cách</dt>
            <dd>{vm.distanceText}</dd>
          </div>
        </dl>
      ) : null}
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

