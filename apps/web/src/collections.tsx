import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth-context';
import { IconHistory, IconRefresh } from './icons';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
type CollectionStatus = 'COMPLETED' | 'IN_PROGRESS' | 'PENDING' | 'CANCELLED';
type CollectionRecord = {
  id: string;
  collectedBy: string | null;
  collectedAt: string;
  fillLevelBefore: number;
  fillLevelAfter: number | null;
  status: CollectionStatus;
  notes: string | null;
  bin: { binCode: string; name: string };
};

const statusLabels: Record<CollectionStatus, string> = {
  COMPLETED: 'Hoàn tất',
  IN_PROGRESS: 'Đang thực hiện',
  PENDING: 'Chờ xử lý',
  CANCELLED: 'Đã hủy'
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Chưa có dữ liệu' : date.toLocaleString('vi-VN');
}

export function CollectionsPage() {
  const { token } = useAuth();
  const [records, setRecords] = useState<CollectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | CollectionStatus>('ALL');
  const [binCode, setBinCode] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const loadCollections = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${apiUrl}/api/collections`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Không thể tải lịch sử thu gom.');
      const payload = await response.json() as { collections: CollectionRecord[] };
      setRecords(payload.collections);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải lịch sử thu gom.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadCollections(); });
    return () => { active = false; };
  }, [loadCollections]);
  const refreshCollections = () => { setLoading(true); setError(''); void loadCollections(); };

  const bins = useMemo(() => [...new Set(records.map((record) => record.bin.binCode))].sort(), [records]);
  const filteredRecords = useMemo(() => records.filter((record) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesQuery = !query || `${record.bin.binCode} ${record.bin.name} ${record.collectedBy ?? ''} ${record.notes ?? ''}`.toLocaleLowerCase().includes(query);
    const timestamp = new Date(record.collectedAt).getTime();
    const matchesFrom = !from || timestamp >= new Date(from).getTime();
    const matchesTo = !to || timestamp <= new Date(to).getTime();
    return matchesQuery && matchesFrom && matchesTo && (status === 'ALL' || record.status === status) && (binCode === 'ALL' || record.bin.binCode === binCode);
  }), [records, search, status, binCode, from, to]);

  return (
    <section className="page collections-page">
      <div className="page-heading">
        <div><div className="eyebrow">NHẬT KÝ VẬN HÀNH</div><h1>Lịch sử thu gom</h1><p>Theo dõi các lượt thu gom đã ghi nhận trong hệ thống.</p></div>
        <button className="button-secondary refresh-button" type="button" onClick={refreshCollections} disabled={loading}><IconRefresh /> Làm mới</button>
      </div>
      <div className="filter-bar">
        <label className="search-field">Tìm kiếm<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mã thùng, nhân viên hoặc ghi chú" /></label>
        <label>Trạng thái<select value={status} onChange={(event) => setStatus(event.target.value as 'ALL' | CollectionStatus)}><option value="ALL">Tất cả trạng thái</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Thùng rác<select value={binCode} onChange={(event) => setBinCode(event.target.value)}><option value="ALL">Tất cả thùng</option>{bins.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
        <label>Từ ngày<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Đến ngày<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>

      {loading ? <div className="skeleton-table" aria-label="Đang tải lịch sử thu gom"><div /><div /><div /><div /></div>
        : error ? <div className="state-panel state-panel--error"><IconHistory /><strong>Không thể tải lịch sử</strong><span>{error}</span><button className="button-secondary" type="button" onClick={refreshCollections}>Thử lại</button></div>
          : filteredRecords.length === 0 ? <div className="state-panel"><IconHistory /><strong>{records.length ? 'Không tìm thấy bản ghi phù hợp' : 'Chưa có lịch sử thu gom'}</strong><span>{records.length ? 'Điều chỉnh các bộ lọc để xem bản ghi khác.' : 'Các lượt thu gom sẽ hiển thị tại đây khi được ghi nhận.'}</span></div>
            : <div className="table-wrap"><table className="collections-table"><thead><tr><th>Thời gian</th><th>Thùng rác</th><th>Nhân viên</th><th>Trước thu gom</th><th>Sau thu gom</th><th>Trạng thái</th></tr></thead><tbody>
              {filteredRecords.map((record) => <tr key={record.id}><td>{formatDate(record.collectedAt)}</td><td><strong>{record.bin.binCode}</strong><span className="muted">{record.bin.name}</span></td><td>{record.collectedBy || 'Chưa xác định'}</td><td>{record.fillLevelBefore}%</td><td>{record.fillLevelAfter === null ? 'Chưa có dữ liệu' : `${record.fillLevelAfter}%`}</td><td><span className={`status-badge status-badge--collection-${record.status.toLowerCase()}`}>{statusLabels[record.status]}</span></td></tr>)}
            </tbody></table></div>}
      <p className="page-footnote">Hiển thị tối đa 200 bản ghi gần nhất theo dữ liệu máy chủ.</p>
    </section>
  );
}