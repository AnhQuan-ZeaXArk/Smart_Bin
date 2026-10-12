import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from './auth-context';
import { translateBinStatus, translateFillCategory } from './i18n-labels';
import { IconActivity, IconRefresh, IconTrash } from './icons';
import { ErrorBoundary } from './error-boundary';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const SensorHistoryChart = lazy(() => import('./sensor-history-chart'));

export type BinStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
export type FillCategory = 'NORMAL' | 'MONITOR' | 'NEARLY_FULL' | 'CRITICAL';

export interface Bin {
  id: string;
  binCode: string;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  capacity: number;
  currentFillLevel: number;
  fillCategory: FillCategory;
  status: BinStatus;
  isActive: boolean;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
  distanceCm?: number | null;
}

type SensorReading = {
  id: string;
  fillLevel: number;
  distance: number;
  timestamp: string;
  bin: { binCode: string; name: string };
};

async function getData<T>(path: string, token?: string | null): Promise<T> {
  let response: Response;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    response = await fetch(`${apiUrl}${path}`, { headers });
  } catch {
    throw new Error('Không thể kết nối đến máy chủ');
  }
  if (response.status === 404) throw new Error('Không tìm thấy thùng rác');
  if (!response.ok) throw new Error('Không thể tải dữ liệu thùng rác từ máy chủ.');
  return response.json() as Promise<T>;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Chưa có dữ liệu';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Chưa có dữ liệu' : date.toLocaleString('vi-VN');
}

function FillMeter({ value, category }: { value: number; category: FillCategory }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="fill-meter">
      <div className="fill-track" role="progressbar" aria-label="Mức độ đầy" aria-valuenow={safeValue} aria-valuemin={0} aria-valuemax={100}>
        <span className={`fill-value fill-${categoryTone(category)}`} style={{ width: `${safeValue}%` }} />
      </div>
      <strong>{safeValue}%</strong>
    </div>
  );
}

function categoryTone(category: FillCategory) {
  if (category === 'CRITICAL') return 'critical';
  if (category === 'NEARLY_FULL') return 'nearly_full';
  if (category === 'MONITOR') return 'monitor';
  return 'normal';
}

function StatusBadge({ status, kind = 'bin' }: { status: BinStatus | FillCategory; kind?: 'bin' | 'fill' }) {
  const tone = kind === 'fill' ? categoryTone(status as FillCategory) : String(status).toLowerCase();
  return <span className={`status-badge status-badge--${tone}`}>{kind === 'fill' ? translateFillCategory(status) : translateBinStatus(status)}</span>;
}

export function BinListPage() {
  const { token, user } = useAuth();
  const [bins, setBins] = useState<Bin[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | BinStatus>('ALL');
  const [fillCategory, setFillCategory] = useState<'ALL' | FillCategory>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadBins = useCallback(async () => {
    try {
      const [result, history] = await Promise.all([
        getData<{ bins: Bin[] }>('/api/bins', token),
        getData<{ readings: SensorReading[] }>('/api/dashboard/sensor-readings', token)
      ]);
      const latestDistance = new Map<string, number>();
      for (const reading of history.readings) {
        if (!latestDistance.has(reading.bin.binCode)) latestDistance.set(reading.bin.binCode, reading.distance);
      }
      setBins(result.bins.map((bin) => ({ ...bin, distanceCm: latestDistance.get(bin.binCode) ?? null })));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải danh sách thùng rác.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadBins(); });
    return () => { active = false; };
  }, [loadBins]);
  const refreshBins = () => { setLoading(true); setError(''); void loadBins(); };

  const visibleBins = useMemo(() => bins.filter((bin) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesQuery = !query || `${bin.binCode} ${bin.name} ${bin.location}`.toLocaleLowerCase().includes(query);
    return matchesQuery && (status === 'ALL' || bin.status === status) && (fillCategory === 'ALL' || bin.fillCategory === fillCategory);
  }), [bins, search, status, fillCategory]);

  return (
    <section className="page bins-page">
      <div className="page-heading">
        <div><div className="eyebrow">QUẢN LÝ TÀI NGUYÊN</div><h1>Quản lý thùng rác</h1><p>Theo dõi mức đầy và trạng thái các thùng trong hệ thống.</p></div>
        <button className="button-secondary refresh-button" type="button" onClick={refreshBins} disabled={loading}><IconRefresh /> Làm mới</button>
      </div>

      <div className="filter-bar">
        <label className="search-field">Tìm thùng rác<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mã thùng, tên hoặc vị trí" /></label>
        <label>Trạng thái<select value={status} onChange={(event) => setStatus(event.target.value as 'ALL' | BinStatus)}><option value="ALL">Tất cả</option><option value="ONLINE">Trực tuyến</option><option value="OFFLINE">Ngoại tuyến</option><option value="MAINTENANCE">Bảo trì</option></select></label>
        <label>Mức độ đầy<select value={fillCategory} onChange={(event) => setFillCategory(event.target.value as 'ALL' | FillCategory)}><option value="ALL">Tất cả</option><option value="NORMAL">Bình thường</option><option value="MONITOR">Cần theo dõi</option><option value="NEARLY_FULL">Gần đầy</option><option value="CRITICAL">Đầy</option></select></label>
      </div>

      {loading ? <div className="skeleton-grid" aria-label="Đang tải thùng rác"><div /><div /><div /></div>
        : error ? <div className="state-panel state-panel--error"><IconActivity /><strong>Không thể tải danh sách</strong><span>{error}</span><button className="button-secondary" type="button" onClick={refreshBins}>Thử lại</button></div>
          : visibleBins.length === 0 ? <div className="state-panel"><IconTrash /><strong>{bins.length ? 'Không tìm thấy thùng phù hợp' : 'Chưa có thùng rác'}</strong><span>{bins.length ? 'Thay đổi bộ lọc hoặc từ khóa tìm kiếm.' : 'Danh sách thùng rác hiện chưa có dữ liệu.'}</span></div>
            : <div className="bin-card-grid">
              {visibleBins.map((bin) => (
                <Link to={`/bins/${bin.id}`} className="bin-card" key={bin.id}>
                  <div className="bin-card__top"><span className="bin-card__icon"><IconTrash /></span><StatusBadge status={bin.status} /></div>
                  <div className="bin-card__title"><span className="device-id-code">{bin.binCode}</span><h2>{bin.name}</h2><p>{bin.location}</p></div>
                  <div className="bin-card__fill"><div><span>Mức độ đầy</span><StatusBadge status={bin.fillCategory} kind="fill" /></div><FillMeter value={bin.currentFillLevel} category={bin.fillCategory} /></div>
                  <div className="bin-card__metrics"><div><span>Khoảng cách</span><strong>{bin.distanceCm === null || bin.distanceCm === undefined ? 'Chưa có dữ liệu' : `${bin.distanceCm} cm`}</strong></div><div><span>Dung tích</span><strong>{bin.capacity.toLocaleString('vi-VN')} L</strong></div><div><span>Cập nhật lần cuối</span><strong>{formatDate(bin.lastSeen)}</strong></div></div>
                  <span className="bin-card__open">Mở chi tiết <span aria-hidden="true">↗</span></span>
                </Link>
              ))}
            </div>}
      {user && user.role !== 'WORKER' && <p className="page-footnote">Thao tác tạo, sửa hoặc ngừng hoạt động thùng chưa được cung cấp trong giao diện hiện tại.</p>}
    </section>
  );
}

export function BinDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [bin, setBin] = useState<Bin | null>(null);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');

  const loadDetail = useCallback(async () => {
    if (!id) return;
    try {
      const { bin: result } = await getData<{ bin: Bin }>(`/api/bins/${encodeURIComponent(id)}`, token);
      setBin(result);
      try {
        const history = await getData<{ readings: SensorReading[] }>(`/api/dashboard/sensor-readings?${new URLSearchParams({ binCode: result.binCode })}`, token);
        setReadings(history.readings);
        setHistoryError('');
      } catch (historyLoadError) {
        setReadings([]);
        setHistoryError(historyLoadError instanceof Error ? historyLoadError.message : 'Không thể tải lịch sử cảm biến.');
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải chi tiết thùng rác.');
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadDetail(); });
    return () => { active = false; };
  }, [loadDetail]);
  const refreshDetail = () => { setLoading(true); setError(''); setHistoryError(''); void loadDetail(); };

  if (loading) return <section className="page detail-page"><Link className="back-link" to="/bins">← Quản lý thùng rác</Link><div className="skeleton-grid"><div /><div /><div /></div></section>;
  if (error || !bin) return <section className="page detail-page"><Link className="back-link" to="/bins">← Quản lý thùng rác</Link><div className="state-panel state-panel--error"><IconActivity /><strong>Không thể tải thông tin thùng rác</strong><span>{error || 'Không tìm thấy thùng rác'}</span><div className="state-panel__actions"><button className="button-secondary" type="button" onClick={refreshDetail}>Thử lại</button><Link className="button-secondary" to="/bins">Quay lại</Link></div></div></section>;

  return (
    <section className="page detail-page">
      <Link className="back-link" to="/bins">← Quản lý thùng rác</Link>
      <div className="page-heading detail-heading"><div><div className="eyebrow">THÔNG TIN THIẾT BỊ</div><h1>{bin.name}</h1><p><span className="device-id-code">{bin.binCode}</span><span className="detail-location">{bin.location}</span></p></div><StatusBadge status={bin.status} /></div>

      <div className="bin-detail-hero">
        <div className="bin-detail-level"><span>MỨC ĐỘ ĐẦY HIỆN TẠI</span><strong>{bin.currentFillLevel}<small>%</small></strong><FillMeter value={bin.currentFillLevel} category={bin.fillCategory} /><StatusBadge status={bin.fillCategory} kind="fill" /></div>
        <div className="bin-detail-facts"><div><span>Khoảng cách gần nhất</span><strong>{readings[0] ? `${readings[0].distance} cm` : 'Chưa có dữ liệu'}</strong></div><div><span>Dung tích</span><strong>{bin.capacity.toLocaleString('vi-VN')} L</strong></div><div><span>Trạng thái thùng</span><strong>{translateBinStatus(bin.status)}</strong></div><div><span>Cập nhật lần cuối</span><strong>{formatDate(bin.lastSeen)}</strong></div></div>
      </div>

      <section className="surface-panel sensor-history-panel">
        <div className="section-heading"><div><div className="eyebrow">TELEMETRY</div><h2>Lịch sử cảm biến</h2><p className="section-subtext">Các lần đo được lưu cho {bin.binCode}.</p></div><button className="button-secondary" type="button" onClick={refreshDetail} disabled={loading}><IconRefresh /> Làm mới</button></div>
        {historyError ? <div className="state-panel state-panel--inline state-panel--error"><IconActivity /><strong>Không thể tải lịch sử cảm biến</strong><span>{historyError}</span><button className="button-secondary" type="button" onClick={refreshDetail}>Thử lại</button></div> : readings.length === 0 ? <div className="state-panel state-panel--inline"><IconActivity /><strong>Chưa có dữ liệu cảm biến</strong><span>Chưa nhận được bản ghi lịch sử cho thùng này.</span></div> : <>
          <div className="sensor-chart"><ErrorBoundary inline title="Không thể tải biểu đồ" message="Bảng dữ liệu bên dưới vẫn hiển thị. Tải lại trang để thử lại."><Suspense fallback={<div className="skeleton-chart" aria-label="Đang tải biểu đồ" />}><SensorHistoryChart readings={readings} /></Suspense></ErrorBoundary></div>
          <div className="table-wrap"><table><thead><tr><th>Thời gian</th><th>Mức đầy</th><th>Khoảng cách</th></tr></thead><tbody>{readings.map((reading) => <tr key={reading.id}><td>{formatDate(reading.timestamp)}</td><td>{reading.fillLevel}%</td><td>{reading.distance} cm</td></tr>)}</tbody></table></div>
        </>}
      </section>
    </section>
  );
}