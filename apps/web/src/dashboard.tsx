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
  IconRefresh,
  IconClose
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
  mergeRestBinsWithRealtimeState,
  groupBinsByStation,
  DEFAULT_STATION_CONFIG,
  ensureAllStationBins,
  ensureStationList,
  type StationGroup
} from './bin-view-model';

type RealtimeTelemetry = {
  binCode: string;
  fillLevel: number | null;
  fillCategory: FillCategory;
  distanceCm: number | null;
  timestamp: string;
  stationCode?: string;
  stationId?: string;
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

    // Cách ly Telemetry theo Station
    const binStationCode = bin.stationCode || (bin as any).station?.code || (bin.stationId === 'station_b_canonical_id' ? 'STATION_B' : (bin.stationId === 'station_a_canonical_id' ? 'STATION_A' : undefined));
    if (event.stationCode && binStationCode && event.stationCode !== binStationCode) {
      return bin;
    }

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

  const installedBins = bins.filter((bin) => bin.installed !== false);
  const onlineNumericBins = installedBins.filter(
    (bin) => typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel) && bin.status !== 'OFFLINE'
  );

  const summary = {
    ...data.summary,
    total: installedBins.length,
    normal: onlineNumericBins.filter((bin) => bin.fillCategory === 'NORMAL').length,
    warning: onlineNumericBins.filter((bin) => bin.fillCategory === 'MONITOR' || bin.fillCategory === 'NEARLY_FULL').length,
    full: onlineNumericBins.filter((bin) => bin.fillCategory === 'CRITICAL').length,
    offline: installedBins.length - onlineNumericBins.length
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

function mergeDeviceHeartbeat(data: DashboardData, hb: any, clientReceiveMs?: number): DashboardData {
  if (!hb) return data;

  // Nếu sự kiện dành cho thiết bị ngoại vi khác (Camera, MQTT) và không phải là nhịp tim trạm, chỉ cập nhật devices, KHÔNG ghi đè ngăn rác
  const isStationHeartbeat = Boolean(hb.stationCode);
  if (hb.deviceId && !isRaspberryPiDevice(hb.deviceId, hb.deviceType) && !isStationHeartbeat) {
    if (data.devices && Array.isArray(data.devices)) {
      const updatedDevices = data.devices.map((d: any) =>
        d.deviceId === hb.deviceId || d.id === hb.id ? { ...d, ...hb } : d
      );
      return { ...data, devices: updatedDevices };
    }
    return data;
  }

  const bins = mergeDeviceHeartbeatToBins(data.bins, hb, clientReceiveMs);

  const installedBins = bins.filter((bin) => bin.installed !== false);
  const onlineNumericBins = installedBins.filter(
    (bin) => typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel) && bin.status !== 'OFFLINE'
  );

  const summary = {
    ...data.summary,
    total: installedBins.length,
    normal: onlineNumericBins.filter((bin) => bin.fillCategory === 'NORMAL').length,
    warning: onlineNumericBins.filter((bin) => bin.fillCategory === 'MONITOR' || bin.fillCategory === 'NEARLY_FULL').length,
    full: onlineNumericBins.filter((bin) => bin.fillCategory === 'CRITICAL').length,
    offline: installedBins.length - onlineNumericBins.length
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
    devices,
    alerts: hb.lidAlert ? ensureLidAlertInList(data.alerts || [], hb.receivedAt || hb.sentAt) : data.alerts
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
  const [stations, setStations] = useState<StationOption[]>(DEFAULT_STATION_CONFIG);
  const [selectedStationCode, setSelectedStationCode] = useState<string>('');
  const [collapsedStations, setCollapsedStations] = useState<Record<string, boolean>>({});
  const [activeModalStation, setActiveModalStation] = useState<'STATION_A' | 'STATION_B' | null>(null);

  const toggleStationCollapse = (code: string) => {
    setCollapsedStations((prev) => ({
      ...prev,
      [code]: !prev[code]
    }));
  };

  const handleScrollToStation = (stationCode: string) => {
    if (collapsedStations[stationCode]) {
      setCollapsedStations((prev) => ({
        ...prev,
        [stationCode]: false
      }));
    }
    setTimeout(() => {
      const el = document.querySelector(`[data-station-code="${stationCode}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('station-section--highlighted');
        setTimeout(() => {
          el.classList.remove('station-section--highlighted');
        }, 2000);
      }
    }, 80);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveModalStation(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Load danh sách Stations từ API (nếu Backend có cấu hình trạm mới hơn, cập nhật; nếu không dùng cấu hình trạm mặc định)
  useEffect(() => {
    getData<{ stations: StationOption[] }>('/api/stations', token)
      .then((res) => {
        if (res && Array.isArray(res.stations) && res.stations.length > 0) {
          // Round 22: Tự động bổ sung fallback Station B nếu API Production chưa migration
          const merged = ensureStationList(res.stations);
          setStations(merged);
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
          const apiBins = result.bins || [];
          const resolvedBins: DashboardBin[] = ensureAllStationBins(apiBins, selectedStationCode);

          setData((currentData) => {
            const mergedBins = mergeRestBinsWithRealtimeState(
              currentData?.bins,
              resolvedBins,
              Date.now()
            );
            return {
              ...result,
              bins: mergedBins
            };
          });
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
    } else {
      realtime.emit('subscribe:station', { stationCode: 'ALL' });
    }

    const onTelemetry = (event: RealtimeTelemetry) => {
      setData((current) => (current ? mergeTelemetry(current, event) : current));
    };

    const onHeartbeat = (payload: any) => {
      setData((current) => (current ? mergeDeviceHeartbeat(current, payload, Date.now()) : current));
    };

    const onStatus = (payload: any) => {
      if (!payload) return;
      // device:status chỉ cập nhật metadata trong data.devices, KHÔNG ghi đè dữ liệu cảm biến ngăn rác
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

  // Round 19.1: KPI counts computed strictly across all configured stations from real data
  const allInstalledCompartments = stationGroups.flatMap((g) =>
    g.compartments.filter((c) => c.bin && c.bin.installed !== false).map((c) => c.bin!)
  );

  const totalStationsCount = stationGroups.length;
  const totalInstalledBins = allInstalledCompartments.length;
  const onlineStationsCount = stationGroups.filter((g) => g.status === 'ONLINE').length;

  // Crucial: bins with installed === false are NOT offline and MUST NOT trigger false offline alerts
  const offlineBinsCount = allInstalledCompartments.filter((bin) => {
    const vm = computeBinViewModel(bin, clock);
    return !vm.isValidReading || bin.status === 'OFFLINE';
  }).length;

  const nearlyFullCount = allInstalledCompartments.filter((bin) => {
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

      {/* Sơ đồ bố trí trạm SMARTBIN (Trạm A và Trạm B) */}
      <section className="station-maps-section" aria-label="Sơ đồ bố trí trạm SMARTBIN">
        <div className="section-heading station-maps-heading">
          <div>
            <h2>Sơ đồ bố trí trạm SMARTBIN</h2>
            <p className="section-subtext">Vị trí trực quan và phân loại 3 thùng rác tại từng cụm trạm thu gom.</p>
          </div>
          <span className="station-maps-note">Nhấp vào hình ảnh để xem phóng to sơ đồ &amp; trạng thái từng thùng</span>
        </div>

        <div className="station-maps-grid">
          {/* Cụm Trạm A (bên trái) */}
          <StationMapCard
            stationCode="STATION_A"
            stationName="Trạm A"
            areaLabel="Cụm Trạm A • Cổng phía Tây"
            imageSrc="/station-a-map.png"
            imageAlt="Sơ đồ bố trí Trạm A (Thùng rác A1, A2, A3)"
            group={stationGroups.find((g) => g.code === 'STATION_A')}
            onZoom={() => setActiveModalStation('STATION_A')}
            onNavigate={() => handleScrollToStation('STATION_A')}
          />

          {/* Cụm Trạm B (bên phải) */}
          <StationMapCard
            stationCode="STATION_B"
            stationName="Trạm B"
            areaLabel="Cụm Trạm B • Cổng phía Đông"
            imageSrc="/station-b-map.png"
            imageAlt="Sơ đồ bố trí Trạm B (Thùng rác B1, B2, B3)"
            group={stationGroups.find((g) => g.code === 'STATION_B')}
            onZoom={() => setActiveModalStation('STATION_B')}
            onNavigate={() => handleScrollToStation('STATION_B')}
          />
        </div>
      </section>

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

      {/* Lightbox Modal chi tiết trạm */}
      {activeModalStation && (
        <StationMapModal
          stationCode={activeModalStation}
          group={stationGroups.find((g) => g.code === activeModalStation)}
          onClose={() => setActiveModalStation(null)}
          onNavigate={() => {
            const target = activeModalStation;
            setActiveModalStation(null);
            handleScrollToStation(target);
          }}
        />
      )}
    </section>
  );
}

const BIN_MAPPINGS: Record<
  'STATION_A' | 'STATION_B',
  Array<{
    code: string;
    key: WasteCategoryKey;
    type: 'recycle' | 'organic' | 'general';
    label: string;
    desc: string;
  }>
> = {
  STATION_A: [
    { code: 'A1', key: 'RECYCLABLE', type: 'recycle', label: 'Tái chế', desc: 'Giấy, nhựa, kim loại' },
    { code: 'A2', key: 'ORGANIC', type: 'organic', label: 'Hữu cơ', desc: 'Thức ăn, lá cây, ...' },
    { code: 'A3', key: 'NON_RECYCLABLE', type: 'general', label: 'Còn lại', desc: 'Rác sinh hoạt khác' }
  ],
  STATION_B: [
    { code: 'B1', key: 'RECYCLABLE', type: 'recycle', label: 'Tái chế', desc: 'Giấy, nhựa, kim loại' },
    { code: 'B2', key: 'ORGANIC', type: 'organic', label: 'Hữu cơ', desc: 'Thức ăn, lá cây, ...' },
    { code: 'B3', key: 'NON_RECYCLABLE', type: 'general', label: 'Còn lại', desc: 'Rác sinh hoạt khác' }
  ]
};

function StationMapCard({
  stationCode,
  stationName,
  areaLabel,
  imageSrc,
  imageAlt,
  group,
  onZoom,
  onNavigate
}: {
  stationCode: 'STATION_A' | 'STATION_B';
  stationName: string;
  areaLabel: string;
  imageSrc: string;
  imageAlt: string;
  group?: StationGroup<DashboardBin>;
  onZoom: () => void;
  onNavigate: () => void;
}) {
  const isStationA = stationCode === 'STATION_A';
  const binDefs = BIN_MAPPINGS[stationCode];
  const status = group?.status ?? 'OFFLINE';

  return (
    <article className={`station-map-card station-map-card--${stationCode.toLowerCase()}`}>
      <div className="station-map-card__header">
        <div className="station-map-card__identity">
          <span className={`station-code-chip ${isStationA ? 'station-code-chip--a' : ''}`}>
            {stationCode}
          </span>
          <div>
            <h3 className="station-map-card__title">{stationName}</h3>
            <span className="station-map-card__area">{areaLabel}</span>
          </div>
        </div>

        <span className={`station-status-badge status-badge--${status.toLowerCase()}`}>
          <span className="status-dot" />
          {status === 'ONLINE' ? 'Trực tuyến' : status === 'WARNING' ? 'Cảnh báo' : 'Mất kết nối'}
        </span>
      </div>

      <div
        className="station-map-card__image-wrap"
        onClick={onZoom}
        title="Nhấp để phóng to sơ đồ và xem thông tin chi tiết"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onZoom();
          }
        }}
      >
        <img
          src={imageSrc}
          alt={imageAlt}
          className="station-map-card__image"
          loading="lazy"
        />
        <div className="station-map-card__overlay">
          <span className="station-map-card__zoom-pill">
            🔍 Phóng to &amp; Xem chi tiết
          </span>
        </div>
      </div>

      <div className="station-map-card__bins-row">
        {binDefs.map((def) => {
          const comp = group?.compartments.find((c) => c.key === def.key);
          const bin = comp?.bin;
          const isInstalled = bin && bin.installed !== false;
          const fillLevel = typeof bin?.currentFillLevel === 'number' ? Math.round(bin.currentFillLevel) : null;

          return (
            <div
              key={def.code}
              className="station-map-bin-chip"
              title={`${def.code}: ${def.label} (${def.desc})`}
            >
              <div className="station-map-bin-chip__top">
                <span className="station-map-bin-chip__code">
                  <span className={`station-map-bin-chip__indicator station-map-bin-chip__indicator--${def.type}`} />
                  {def.code}
                </span>
                <span className="station-map-bin-chip__pct">
                  {!isInstalled ? 'Dự phòng' : fillLevel !== null ? `${fillLevel}%` : '—'}
                </span>
              </div>
              <span className="station-map-bin-chip__label">{def.label}</span>
            </div>
          );
        })}
      </div>

      <div className="station-map-card__actions">
        <button
          type="button"
          className="station-map-action-btn station-map-action-btn--secondary"
          onClick={onZoom}
        >
          🔍 Xem chi tiết sơ đồ
        </button>
        <button
          type="button"
          className="station-map-action-btn station-map-action-btn--primary"
          onClick={onNavigate}
        >
          ⬇ Đến dữ liệu trạm
        </button>
      </div>
    </article>
  );
}

function StationMapModal({
  stationCode,
  group,
  onClose,
  onNavigate
}: {
  stationCode: 'STATION_A' | 'STATION_B';
  group?: StationGroup<DashboardBin>;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const isStationA = stationCode === 'STATION_A';
  const stationName = isStationA ? 'Trạm A' : 'Trạm B';
  const binPrefix = isStationA ? 'A' : 'B';
  const imageSrc = isStationA ? '/station-a-map.png' : '/station-b-map.png';
  const imageAlt = `Sơ đồ bố trí chi tiết ${stationName}`;
  const binDefs = BIN_MAPPINGS[stationCode];
  const status = group?.status ?? 'OFFLINE';

  return (
    <div
      className="station-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Sơ đồ chi tiết ${stationName}`}
    >
      <div className="station-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="station-modal-header">
          <div className="station-modal-title-wrap">
            <span className={`station-code-chip ${isStationA ? 'station-code-chip--a' : ''}`}>
              {stationCode}
            </span>
            <h3 className="station-modal-title">
              Sơ đồ bố trí chi tiết {stationName} ({binPrefix}1 – {binPrefix}3)
            </h3>
            <span className={`station-status-badge status-badge--${status.toLowerCase()}`}>
              <span className="status-dot" />
              {status === 'ONLINE' ? 'Trực tuyến' : status === 'WARNING' ? 'Cảnh báo' : 'Mất kết nối'}
            </span>
          </div>
          <button
            type="button"
            className="station-modal-close-btn"
            onClick={onClose}
            aria-label="Đóng"
          >
            <IconClose />
          </button>
        </div>

        <div className="station-modal-body">
          <div className="station-modal-img-wrap">
            <img src={imageSrc} alt={imageAlt} className="station-modal-img" />
          </div>

          <div className="station-modal-bins-section">
            <h4 className="station-modal-bins-heading">Danh sách 3 thùng rác tại {stationName}:</h4>
            <div className="station-modal-bins-list">
              {binDefs.map((def) => {
                const comp = group?.compartments.find((c) => c.key === def.key);
                const bin = comp?.bin;
                const isInstalled = bin && bin.installed !== false;
                const fillLevel = typeof bin?.currentFillLevel === 'number' ? Math.round(bin.currentFillLevel) : null;

                return (
                  <div key={def.code} className="station-modal-bin-item">
                    <div className="station-modal-bin-item__header">
                      <span className="station-modal-bin-item__title">
                        <span className={`station-map-bin-chip__indicator station-map-bin-chip__indicator--${def.type}`} />
                        {def.code} – {def.label}
                      </span>
                      <span className="station-modal-bin-item__pct">
                        {!isInstalled ? 'Chưa lắp' : fillLevel !== null ? `${fillLevel}%` : '—'}
                      </span>
                    </div>
                    <p className="station-modal-bin-item__desc">{def.desc}</p>
                    {isInstalled && fillLevel !== null && (
                      <div className="station-modal-bin-item__bar-wrap">
                        <div
                          className="station-modal-bin-item__bar"
                          style={{
                            width: `${Math.min(100, Math.max(0, fillLevel))}%`,
                            background: def.type === 'recycle' ? '#38bdf8' : def.type === 'organic' ? '#34d399' : '#facc15'
                          }}
                        />
                      </div>
                    )}
                    <div className="station-modal-bin-item__status">
                      <span>Trạng thái:</span>
                      <strong>
                        {!isInstalled
                          ? 'Sẵn sàng mở rộng'
                          : bin?.status === 'ONLINE'
                          ? 'Đang hoạt động'
                          : 'Mất kết nối'}
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="station-modal-footer">
          <button
            type="button"
            className="station-map-action-btn station-map-action-btn--secondary"
            onClick={onClose}
          >
            Đóng
          </button>
          <button
            type="button"
            className="station-map-action-btn station-map-action-btn--primary"
            onClick={onNavigate}
          >
            Đi đến khu vực giám sát của {stationName} ↓
          </button>
        </div>
      </div>
    </div>
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
  const isInstalled = bin.installed !== false;
  const cardStationCode = stationCode || (bin as any).stationCode || (bin as any).station?.code || 'STATION_A';

  // 1. Ngăn chưa lắp đặt phần cứng (Station B Organic & Non-recyclable)
  if (!isInstalled || vm.isUninstalled) {
    return (
      <article
        className="waste-card waste-tone-unavailable waste-card--uninstalled"
        data-station={cardStationCode}
        data-installed="false"
      >
        <div className="waste-card-header">
          <div className="waste-card-identity">
            <h3>{label}</h3>
            <span className="device-id-code">{bin.binCode}</span>
          </div>
          <span className="status-badge status-badge--uninstalled">
            Chưa lắp đặt
          </span>
        </div>
        <div className="waste-percentage-row">
          <strong className="waste-percentage text-unavailable">—</strong>
        </div>
        <div className="waste-card-uninstalled-note">
          <span>Ngăn này chưa gắn cảm biến đo mức đầy. Sẵn sàng cấu hình mở rộng phần cứng.</span>
        </div>
      </article>
    );
  }

  // 2. Thùng rác đã lắp đặt (Installed bin cards - Station A và Station B Recyclable):
  // Giao diện tinh gọn, hiển thị rõ ràng Tên thùng, Loại rác, Phần trăm và Thanh tiến trình chuẩn xác.
  // Đã loại bỏ các phần tử thừa theo yêu cầu:
  // - Loại bỏ "(Gần nhất: xx%)"
  // - Loại bỏ "CẦN KIỂM TRA"
  // - Loại bỏ "Cập nhật x phút trước"
  // - Loại bỏ badge cá nhân "MẤT KẾT NỐI" (trùng lặp với trạng thái trạm ở header)
  // - Loại bỏ các dòng cảnh báo trùng lặp đỏ/xám.
  const safeFill = vm.isValidReading ? Math.max(0, Math.min(100, vm.fillPct)) : null;
  const displayPct = safeFill !== null ? `${safeFill}%` : '—';
  const progressWidth = safeFill !== null ? `${safeFill}%` : '0%';

  return (
    <article
      className={`waste-card waste-tone-${vm.tone}`}
      data-station={cardStationCode}
      data-installed="true"
    >
      <div className="waste-card-header">
        <div className="waste-card-identity">
          <h3>{label}</h3>
          <span className="device-id-code">{bin.binCode}</span>
        </div>
      </div>

      <div className="waste-percentage-row">
        <span className="waste-caption">Mức đầy thùng rác</span>
        <strong className={`waste-percentage ${!vm.isValidReading ? 'text-unavailable' : ''}`}>
          {displayPct}
        </strong>
      </div>

      <div
        className={`waste-progress-track ${!vm.isValidReading ? 'is-unavailable' : ''}`}
        role="progressbar"
        aria-label="Mức đầy thùng rác"
        aria-valuenow={safeFill ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={`waste-progress-fill ${vm.isValidReading ? `waste-tone-${vm.tone}` : 'is-unavailable'}`}
          style={{ width: progressWidth }}
        />
      </div>

      {vm.hasDistance && (
        <dl className="waste-card-facts">
          <div>
            <dt>Khoảng cách</dt>
            <dd>{vm.distanceText}</dd>
          </div>
        </dl>
      )}
    </article>
  );
}

export function SensorHistoryPage() {
  const { token } = useAuth();
  const [bins, setBins] = useState<Bin[]>([]);
  const [binsLoaded, setBinsLoaded] = useState(false);
  const [readings, setReadings] = useState<DashboardData['recentSensorReadings']>([]);
  const [stationCode, setStationCode] = useState<'ALL' | 'STATION_A' | 'STATION_B'>('ALL');
  const [category, setCategory] = useState<'ALL' | WasteCategoryKey>('ALL');
  const [range, setRange] = useState<'ALL' | 'TODAY' | '7D' | '30D'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    getData<{ bins: Bin[] }>('/api/bins', token)
      .then((result) => { if (active) setBins(ensureAllStationBins(result.bins)); })
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
    if (stationCode !== 'ALL') {
      params.set('stationCode', stationCode);
    }
    if (category !== 'ALL') {
      params.set('binCode', category);
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
  }, [token, binsLoaded, stationCode, category, range, error]);

  const visibleReadings = readings.filter((reading) => category === 'ALL' || categoryByBinCode.has(reading.bin.binCode));
  const refreshHistory = () => { setLoading(true); setError(''); setRefreshKey((value) => value + 1); };

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">LỊCH SỬ DỮ LIỆU CẢM BIẾN</div>
          <h1>Lịch sử cảm biến</h1>
          <p>Lịch sử dữ liệu từ các cảm biến siêu âm của hệ thống SmartBin theo từng trạm.</p>
        </div>
        <button className="button-secondary refresh-button" type="button" onClick={refreshHistory} disabled={loading}><IconRefresh /> Làm mới</button>
      </div>
      <div className="filter-bar">
        <label>
          Trạm thu gom
          <select value={stationCode} onChange={(event) => { setLoading(true); setStationCode(event.target.value as 'ALL' | 'STATION_A' | 'STATION_B'); }}>
            <option value="ALL">Tất cả các trạm</option>
            <option value="STATION_A">Trạm A (STATION_A)</option>
            <option value="STATION_B">Trạm B (STATION_B)</option>
          </select>
        </label>
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
                <th>Trạm</th>
                <th>Loại rác</th>
                <th>Mức độ đầy</th>
                <th>Khoảng cách đo được</th>
                <th>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {visibleReadings.map((reading) => (
                <tr key={reading.id}>
                  <td><span className="device-id-code">{(reading.bin as any).station?.code || ((reading.bin as any).stationId === 'station_b_canonical_id' ? 'STATION_B' : 'STATION_A')}</span></td>
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

export const LID_ALERT_ID = 'lid-alert-station-a';
export const LID_ALERT_MESSAGE = 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!';

export function ensureLidAlertInList(current: DashboardAlert[], createdAt?: string): DashboardAlert[] {
  const hasLidAlert = current.some(
    (item) => item.id === LID_ALERT_ID || (item.message === LID_ALERT_MESSAGE && !item.isResolved)
  );
  if (hasLidAlert) {
    return current;
  }
  const lidAlertItem: DashboardAlert = {
    id: LID_ALERT_ID,
    type: 'SENSOR_ABNORMAL',
    severity: 'CRITICAL',
    message: LID_ALERT_MESSAGE,
    createdAt: createdAt || new Date().toISOString(),
    bin: null,
    deviceId: null,
    isResolved: false,
    resolvedAt: null
  };
  return [lidAlertItem, ...current];
}

export function AlertsPage() {
  const { token } = useAuth();
  const { socket } = useRealtime();
  const [alerts, setAlerts] = useState<DashboardData['alerts']>([]);
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'>('ALL');
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
          const hasLid = data.alerts.some((a) => a.message === LID_ALERT_MESSAGE && !a.isResolved);
          console.log(`[AlertsPage] Fetched /api/dashboard/alerts: ${data.alerts.length} alerts (hasLidAlert=${hasLid})`);
          for (const alert of data.alerts) {
            seenAlertIds.current.add(alert.id);
            if (alert.message === LID_ALERT_MESSAGE && !alert.isResolved) {
              seenAlertIds.current.add(LID_ALERT_ID);
            }
          }
          setAlerts((current) => {
            const currentIds = new Set(current.map((alert) => alert.id));
            const hasUnresolvedLid = current.some(
              (alert) => alert.id === LID_ALERT_ID || (alert.message === LID_ALERT_MESSAGE && !alert.isResolved)
            );
            let seenLidInBatch = hasUnresolvedLid;
            const filteredIncoming: DashboardAlert[] = [];
            for (const alert of data.alerts) {
              if (currentIds.has(alert.id)) continue;
              if (alert.message === LID_ALERT_MESSAGE && !alert.isResolved) {
                if (seenLidInBatch) continue;
                seenLidInBatch = true;
                filteredIncoming.push({
                  ...alert,
                  bin: null,
                  deviceId: null
                });
              } else {
                filteredIncoming.push(alert);
              }
            }
            return [...current, ...filteredIncoming];
          });
        }
      })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Không thể tải cảnh báo.'); })
      .finally(() => { if (active) setLoading(false); });

    getData<{ data?: { lidAlert?: boolean; receivedAt?: string }; lidAlert?: boolean }>('/api/demo/device-status', token)
      .then((statusRes) => {
        const isLidAlertActive = Boolean(statusRes?.data?.lidAlert || statusRes?.lidAlert);
        console.log(`[AlertsPage] Fetched /api/demo/device-status: lidAlert=${isLidAlertActive}`);
        if (active && isLidAlertActive) {
          seenAlertIds.current.add(LID_ALERT_ID);
          setAlerts((current) => ensureLidAlertInList(current, statusRes?.data?.receivedAt));
        }
      })
      .catch(() => {});

    return () => { active = false; };
  }, [token, refreshKey]);

  useEffect(() => {
    if (!socket) return;
    const onCreated = (alert: DashboardAlert) => {
      console.log('[AlertsPage] Realtime alert:created received:', alert.id, alert.message);
      if (alert.message === LID_ALERT_MESSAGE && !alert.isResolved) {
        if (seenAlertIds.current.has(alert.id) || seenAlertIds.current.has(LID_ALERT_ID)) return;
        seenAlertIds.current.add(alert.id);
        seenAlertIds.current.add(LID_ALERT_ID);
        setRecentAlertIds((current) => new Set(current).add(LID_ALERT_ID));
        setAlerts((current) => ensureLidAlertInList(current, alert.createdAt));
        return;
      }
      if (seenAlertIds.current.has(alert.id)) return;
      seenAlertIds.current.add(alert.id);
      setRecentAlertIds((current) => new Set(current).add(alert.id));
      setAlerts((current) => current.some((item) => item.id === alert.id) ? current : [alert, ...current]);
    };
    const onLidAlert = (payload: any) => {
      console.log('[AlertsPage] Realtime device:lid:alert received:', payload);
      if (!seenAlertIds.current.has(LID_ALERT_ID)) {
        seenAlertIds.current.add(LID_ALERT_ID);
        setRecentAlertIds((current) => new Set(current).add(LID_ALERT_ID));
      }
      setAlerts((current) => ensureLidAlertInList(current, payload?.timestamp));
    };
    const onHeartbeat = (payload: any) => {
      if (payload?.lidAlert) {
        console.log('[AlertsPage] Realtime device:heartbeat with lidAlert=true received:', payload);
        if (!seenAlertIds.current.has(LID_ALERT_ID)) {
          seenAlertIds.current.add(LID_ALERT_ID);
          setRecentAlertIds((current) => new Set(current).add(LID_ALERT_ID));
        }
        setAlerts((current) => ensureLidAlertInList(current, payload?.receivedAt || payload?.sentAt));
      }
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
    socket.on('device:lid:alert', onLidAlert);
    socket.on('device:heartbeat', onHeartbeat);
    socket.on('alert:updated', onUpdated);
    socket.on('alert:resolved', onResolved);
    return () => {
      socket.off('alert:created', onCreated);
      socket.off('device:lid:alert', onLidAlert);
      socket.off('device:heartbeat', onHeartbeat);
      socket.off('alert:updated', onUpdated);
      socket.off('alert:resolved', onResolved);
    };
  }, [socket]);

  const visibleAlerts = useMemo(() => alerts.filter((alert) => {
    return filter === 'ALL' || alert.severity === filter;
  }), [alerts, filter]);
  const refreshAlerts = () => { setLoading(true); setError(''); setRefreshKey((value) => value + 1); };

  return (
    <section className="page alerts-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">EVENT MONITOR</div>
          <h1>Trung tâm cảnh báo</h1>
          <p>Theo dõi sự kiện và cảnh báo hệ thống theo thời gian thực.</p>
        </div>
        <button className="button-secondary refresh-button" type="button" onClick={refreshAlerts} disabled={loading}><IconRefresh /> Làm mới</button>
      </div>
      <div className="alert-filter-tabs" role="tablist" aria-label="Lọc theo mức độ cảnh báo">
        {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const).map((severity) => <button key={severity} type="button" role="tab" aria-selected={filter === severity} className={filter === severity ? 'active' : ''} onClick={() => setFilter(severity)}>{severity === 'ALL' ? 'Tất cả' : translateAlertSeverity(severity)}<span>{severity === 'ALL' ? alerts.length : alerts.filter((alert) => alert.severity === severity).length}</span></button>)}
      </div>
      {loading ? <div className="skeleton-list"><div /><div /><div /></div>
        : error ? <div className="state-panel state-panel--error"><IconActivity /><strong>Không thể tải cảnh báo</strong><span>{error}</span><button className="button-secondary" type="button" onClick={refreshAlerts}>Thử lại</button></div>
          : visibleAlerts.length === 0 ? <div className="state-panel"><IconActivity /><strong>{alerts.length ? 'Không có cảnh báo trong nhóm này' : 'Chưa có cảnh báo'}</strong><span>{alerts.length ? 'Chọn bộ lọc khác để xem sự kiện.' : 'Các sự kiện vận hành sẽ hiển thị tại đây khi được ghi nhận.'}</span></div>
            : (
        <div className="alert-list alert-list--monitor">
          {visibleAlerts.map((alert) => (
            <article className={`alert-row alert-row--${alert.severity.toLowerCase()}${recentAlertIds.has(alert.id) ? ' alert-row--realtime-new' : ''}`} key={alert.id} onAnimationEnd={() => {
              if (recentAlertIds.has(alert.id)) setRecentAlertIds((current) => {
                const next = new Set(current);
                next.delete(alert.id);
                return next;
              });
            }}>
              <span className={`badge badge-${badge(alert.severity)}`}>{translateAlertSeverity(alert.severity)}</span>
              <strong>{alert.message === LID_ALERT_MESSAGE ? 'Hệ thống' : (alert.bin?.binCode ?? (alert.deviceId || 'Hệ thống'))}</strong>
              <span>{alert.message}</span>
              <small>{ago(alert.createdAt)}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

