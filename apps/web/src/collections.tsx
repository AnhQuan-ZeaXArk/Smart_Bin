import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth-context';
import { IconHistory, IconRefresh } from './icons';
import { apiUrl } from './api-config';

type CollectionStatus = 'COMPLETED' | 'IN_PROGRESS' | 'PENDING' | 'CANCELLED';

type CollectionRecord = {
  id: string;
  sessionId?: string;
  stationId?: string;
  stationCode?: string;
  stationName?: string;
  triggerSource?: string;
  openedAt?: string;
  closedAt?: string | null;
  collectedBy: string | null;
  collectedAt: string;
  fillLevelBefore: number | null;
  fillLevelAfter: number | null;
  status: CollectionStatus;
  notes: string | null;
  bin: {
    binCode: string;
    name: string;
    stationId?: string | null;
    station?: { code: string; name: string } | null;
  };
};

type CollectionSessionRow = {
  sessionId: string;
  stationId: string;
  stationName: string;
  triggerSource: string;
  openedAt: string;
  closedAt: string | null;
  fillLevelBefore: number | null;
  status: CollectionStatus;
};

const statusLabels: Record<CollectionStatus, string> = {
  COMPLETED: 'Đã đóng',
  IN_PROGRESS: 'Đang mở',
  PENDING: 'Chờ xử lý',
  CANCELLED: 'Đã hủy'
};

function formatDate(value: string | null | undefined, emptyLabel = 'Chưa đóng') {
  if (!value) return emptyLabel;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? emptyLabel : date.toLocaleString('vi-VN');
}

function normalizeSessionRow(record: CollectionRecord): CollectionSessionRow {
  let parsedMeta: Partial<CollectionSessionRow> | null = null;
  if (record.notes) {
    try {
      const candidate = JSON.parse(record.notes) as Record<string, unknown>;
      if (candidate && candidate.type === 'COLLECTION_SESSION') {
        parsedMeta = {
          sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
          stationId: typeof candidate.stationId === 'string' ? candidate.stationId : undefined,
          stationName: typeof candidate.stationName === 'string' ? candidate.stationName : undefined,
          triggerSource: typeof candidate.triggerSource === 'string' ? candidate.triggerSource : undefined,
          openedAt: typeof candidate.openedAt === 'string' ? candidate.openedAt : undefined,
          closedAt: typeof candidate.closedAt === 'string' ? candidate.closedAt : null,
          fillLevelBefore:
            typeof candidate.fillLevelBefore === 'number' && candidate.fillLevelBefore >= 0 && candidate.fillLevelBefore <= 100
              ? candidate.fillLevelBefore
              : null
        };
      }
    } catch {
      parsedMeta = null;
    }
  }

  const sessionId = record.sessionId || parsedMeta?.sessionId || record.id;
  const stationCode = record.stationCode || record.bin.station?.code || 'STATION_A';
  const stationId = record.stationId || parsedMeta?.stationId || (stationCode === 'STATION_B' ? 'station_b' : 'station_a');
  const stationName =
    record.stationName ||
    parsedMeta?.stationName ||
    record.bin.station?.name ||
    (stationId === 'station_b' ? 'Trạm B' : 'Trạm A');
  const triggerSource =
    record.triggerSource ||
    parsedMeta?.triggerSource ||
    record.collectedBy ||
    'PHYSICAL_BUTTON';
  const openedAt = record.openedAt || parsedMeta?.openedAt || record.collectedAt;
  const closedAt =
    record.closedAt !== undefined
      ? record.closedAt
      : parsedMeta?.closedAt !== undefined
        ? parsedMeta.closedAt
        : record.status === 'COMPLETED' && !parsedMeta
          ? record.collectedAt
          : null;

  const resolvedFillBefore =
    typeof record.fillLevelBefore === 'number' && record.fillLevelBefore >= 0 && record.fillLevelBefore <= 100
      ? record.fillLevelBefore
      : typeof parsedMeta?.fillLevelBefore === 'number' && parsedMeta.fillLevelBefore >= 0 && parsedMeta.fillLevelBefore <= 100
        ? parsedMeta.fillLevelBefore
        : null;

  return {
    sessionId,
    stationId,
    stationName,
    triggerSource,
    openedAt,
    closedAt,
    fillLevelBefore: resolvedFillBefore,
    status: record.status
  };
}

export function CollectionsPage() {
  const { token } = useAuth();
  const [records, setRecords] = useState<CollectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | CollectionStatus>('ALL');
  const [stationFilter, setStationFilter] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const loadCollections = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(`${apiUrl}/api/collections`, { headers });
      if (!response.ok) throw new Error('Không thể tải lịch sử thu gom.');
      const payload = (await response.json()) as { collections: CollectionRecord[] };
      setRecords(payload.collections);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải lịch sử thu gom.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadCollections();
    });
    return () => {
      active = false;
    };
  }, [loadCollections]);

  const refreshCollections = () => {
    setLoading(true);
    setError('');
    void loadCollections();
  };

  const sessionRows = useMemo(() => {
    const bySession = new Map<string, CollectionSessionRow>();
    for (const record of records) {
      const row = normalizeSessionRow(record);
      if (!bySession.has(row.sessionId)) {
        bySession.set(row.sessionId, row);
      } else {
        const existing = bySession.get(row.sessionId)!;
        if (row.closedAt && !existing.closedAt) {
          existing.closedAt = row.closedAt;
          existing.status = 'COMPLETED';
        }
      }
    }
    return Array.from(bySession.values());
  }, [records]);

  const stations = useMemo(
    () => [...new Set(sessionRows.map((row) => row.stationId))].sort(),
    [sessionRows]
  );

  const filteredSessions = useMemo(
    () =>
      sessionRows.filter((row) => {
        const query = search.trim().toLocaleLowerCase();
        const matchesQuery =
          !query ||
          `${row.sessionId} ${row.stationId} ${row.stationName} ${row.triggerSource}`
            .toLocaleLowerCase()
            .includes(query);
        const timestamp = new Date(row.openedAt).getTime();
        const matchesFrom = !from || timestamp >= new Date(from).getTime();
        const matchesTo = !to || timestamp <= new Date(to).getTime();
        const matchesStatus = status === 'ALL' || row.status === status;
        const matchesStation = stationFilter === 'ALL' || row.stationId === stationFilter;
        return matchesQuery && matchesFrom && matchesTo && matchesStatus && matchesStation;
      }),
    [sessionRows, search, status, stationFilter, from, to]
  );

  return (
    <section className="page collections-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">NHẬT KÝ VẬN HÀNH</div>
          <h1>Lịch sử thu gom</h1>
          <p>Theo dõi các phiên thu gom thủ công trực tuyến theo từng trạm.</p>
        </div>
        <button
          className="button-secondary refresh-button"
          type="button"
          onClick={refreshCollections}
          disabled={loading}
        >
          <IconRefresh /> Làm mới
        </button>
      </div>
      <div className="filter-bar">
        <label className="search-field">
          Tìm kiếm
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Mã phiên, trạm hoặc nguồn kích hoạt"
          />
        </label>
        <label>
          Trạng thái phiên
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as 'ALL' | CollectionStatus)}
          >
            <option value="ALL">Tất cả trạng thái</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trạm
          <select
            value={stationFilter}
            onChange={(event) => setStationFilter(event.target.value)}
          >
            <option value="ALL">Tất cả trạm</option>
            {stations.map((stId) => (
              <option key={stId} value={stId}>
                {stId === 'station_a' ? 'Trạm A (station_a)' : stId === 'station_b' ? 'Trạm B (station_b)' : stId}
              </option>
            ))}
          </select>
        </label>
        <label>
          Từ ngày
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Đến ngày
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <div className="skeleton-table" aria-label="Đang tải lịch sử thu gom">
          <div />
          <div />
          <div />
          <div />
        </div>
      ) : error ? (
        <div className="state-panel state-panel--error">
          <IconHistory />
          <strong>Không thể tải lịch sử</strong>
          <span>{error}</span>
          <button className="button-secondary" type="button" onClick={refreshCollections}>
            Thử lại
          </button>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="state-panel">
          <IconHistory />
          <strong>
            {sessionRows.length ? 'Không tìm thấy phiên thu gom phù hợp' : 'Chưa có lịch sử thu gom'}
          </strong>
          <span>
            {sessionRows.length
              ? 'Điều chỉnh các bộ lọc để xem phiên thu gom khác.'
              : 'Các phiên thu gom trực tuyến sẽ hiển thị tại đây khi được Backend xác nhận lưu thành công.'}
          </span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="collections-table">
            <thead>
              <tr>
                <th>Mã phiên</th>
                <th>Trạm</th>
                <th>Nguồn kích hoạt</th>
                <th>Thời điểm mở</th>
                <th>Thời điểm đóng</th>
                <th>Mức trước mở</th>
                <th>Trạng thái phiên</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((session) => (
                <tr key={session.sessionId}>
                  <td>
                    <code>{session.sessionId}</code>
                  </td>
                  <td>
                    <strong>{session.stationName}</strong>
                    <span className="muted">{session.stationId}</span>
                  </td>
                  <td>
                    <code>{session.triggerSource}</code>
                  </td>
                  <td>{formatDate(session.openedAt, 'Chưa có dữ liệu')}</td>
                  <td>{formatDate(session.closedAt, 'Chưa đóng')}</td>
                  <td>
                    {session.fillLevelBefore === null
                      ? 'Chưa có dữ liệu'
                      : `${session.fillLevelBefore}%`}
                  </td>
                  <td>
                    <span
                      className={`status-badge status-badge--collection-${session.status.toLowerCase()}`}
                    >
                      {statusLabels[session.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="page-footnote">
        Hiển thị tối đa 200 phiên thu gom trực tuyến gần nhất đã được máy chủ xác nhận.
      </p>
    </section>
  );
}
