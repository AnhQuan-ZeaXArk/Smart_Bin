import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth-context';
import { useRealtime } from './realtime-store';
import { IconHistory, IconRefresh } from './icons';
import { apiUrl } from './api-config';

type CollectionStatus = 'COMPLETED' | 'IN_PROGRESS' | 'PENDING' | 'CANCELLED';

export type BinCompartmentInfo = {
  binId?: string;
  binCode: string;
  name: string;
  fillLevelBefore: number | null;
  fillLevelAfter: number | null;
};

export type CollectionRecord = {
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
  compartmentsCount?: number;
  compartments?: BinCompartmentInfo[];
  bin: {
    binCode: string;
    name: string;
    stationId?: string | null;
    station?: { code: string; name: string } | null;
  };
};

export type CollectionSessionRow = {
  sessionId: string;
  stationId: string;
  stationName: string;
  triggerSource: string;
  openedAt: string;
  closedAt: string | null;
  fillLevelBefore: number | null;
  fillLevelAfter: number | null;
  status: CollectionStatus;
  compartmentsCount: number;
  compartments: BinCompartmentInfo[];
};

const statusLabels: Record<CollectionStatus, string> = {
  COMPLETED: 'Đã hoàn tất',
  IN_PROGRESS: 'Đang mở',
  PENDING: 'Chờ xử lý',
  CANCELLED: 'Đã hủy'
};

const triggerLabels: Record<string, string> = {
  PHYSICAL_BUTTON: 'Nút bấm vật lý (ESP32)',
  WEB_DASHBOARD: 'Bảng điều khiển Web'
};

function formatTriggerSource(source: string | null | undefined): string {
  if (!source) return 'Nút bấm vật lý (ESP32)';
  return triggerLabels[source] || source;
}

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
        const rawComps = Array.isArray(candidate.compartments) ? candidate.compartments : [];
        const compartments: BinCompartmentInfo[] = rawComps.map((c: any) => ({
          binId: typeof c.binId === 'string' ? c.binId : undefined,
          binCode: typeof c.binCode === 'string' ? c.binCode : 'UNKNOWN',
          name: typeof c.name === 'string' ? c.name : 'Ngăn rác',
          fillLevelBefore:
            typeof c.fillLevelBefore === 'number' && c.fillLevelBefore >= 0 && c.fillLevelBefore <= 100
              ? c.fillLevelBefore
              : null,
          fillLevelAfter:
            typeof c.fillLevelAfter === 'number' && c.fillLevelAfter >= 0 && c.fillLevelAfter <= 100
              ? c.fillLevelAfter
              : null
        }));

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
              : null,
          fillLevelAfter:
            typeof candidate.fillLevelAfter === 'number' && candidate.fillLevelAfter >= 0 && candidate.fillLevelAfter <= 100
              ? candidate.fillLevelAfter
              : null,
          compartmentsCount:
            typeof candidate.compartmentsCount === 'number' ? candidate.compartmentsCount : (compartments.length || 3),
          compartments
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

  const resolvedFillAfter =
    typeof record.fillLevelAfter === 'number' && record.fillLevelAfter >= 0 && record.fillLevelAfter <= 100
      ? record.fillLevelAfter
      : typeof parsedMeta?.fillLevelAfter === 'number' && parsedMeta.fillLevelAfter >= 0 && parsedMeta.fillLevelAfter <= 100
        ? parsedMeta.fillLevelAfter
        : (record.status === 'COMPLETED' ? 0 : null);

  const defaultCompartments: BinCompartmentInfo[] = [
    { binCode: 'RECYCLABLE', name: 'Rác tái chế', fillLevelBefore: resolvedFillBefore, fillLevelAfter: resolvedFillAfter },
    { binCode: 'ORGANIC', name: 'Rác hữu cơ', fillLevelBefore: resolvedFillBefore, fillLevelAfter: resolvedFillAfter },
    { binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế', fillLevelBefore: resolvedFillBefore, fillLevelAfter: resolvedFillAfter }
  ];

  const compartments =
    record.compartments && record.compartments.length > 0
      ? record.compartments
      : parsedMeta?.compartments && parsedMeta.compartments.length > 0
        ? parsedMeta.compartments
        : defaultCompartments;

  const compartmentsCount =
    record.compartmentsCount ?? parsedMeta?.compartmentsCount ?? compartments.length ?? 3;

  return {
    sessionId,
    stationId,
    stationName,
    triggerSource,
    openedAt,
    closedAt,
    fillLevelBefore: resolvedFillBefore,
    fillLevelAfter: resolvedFillAfter,
    status: record.status,
    compartmentsCount,
    compartments
  };
}

export function CollectionsPage() {
  const { token } = useAuth();
  const { socket } = useRealtime();
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

  // Tự động đồng bộ và cập nhật danh sách thu gom khi ESP32 kích hoạt qua nút bấm vật lý
  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => {
      void loadCollections();
    };
    socket.on('collection:session:updated', handleUpdate);
    return () => {
      socket.off('collection:session:updated', handleUpdate);
    };
  }, [socket, loadCollections]);

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
          existing.fillLevelAfter = 0;
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
          <p>
            Theo dõi các phiên thu gom kích hoạt bởi nút bấm vật lý trên thiết bị ESP32-C6 theo từng trạm.
          </p>
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
              : 'Các phiên thu gom kích hoạt bằng nút vật lý từ ESP32 sẽ tự động hiển thị tại đây khi hoàn tất.'}
          </span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="collections-table">
            <thead>
              <tr>
                <th>Mã phiên</th>
                <th>Trạm thu gom</th>
                <th>Số lượng thùng</th>
                <th>Danh sách 3 thùng</th>
                <th>Mức rác (Trước → Sau)</th>
                <th>Thời điểm mở</th>
                <th>Thời điểm đóng</th>
                <th>Nguồn kích hoạt</th>
                <th>Trạng thái</th>
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
                    <span className="muted" style={{ display: 'block', fontSize: '10px' }}>{session.stationId}</span>
                  </td>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: 'rgba(39, 213, 160, 0.15)',
                        color: '#27d5a0',
                        border: '1px solid rgba(39, 213, 160, 0.3)'
                      }}
                    >
                      {session.compartmentsCount} thùng
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {session.compartments && session.compartments.length > 0 ? (
                        session.compartments.map((c, idx) => (
                          <span
                            key={c.binId || idx}
                            style={{
                              display: 'inline-block',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              background: '#1a2c42',
                              color: '#a3bed8',
                              border: '1px solid #253d5a'
                            }}
                          >
                            {c.name || c.binCode}
                          </span>
                        ))
                      ) : (
                        <span className="muted">Tái chế, Hữu cơ, Không tái chế</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <strong>
                      {session.fillLevelBefore === null
                        ? 'Chưa có dữ liệu'
                        : `${session.fillLevelBefore}%`}
                    </strong>
                    <span style={{ margin: '0 4px', color: '#718078' }}>→</span>
                    <strong style={{ color: session.status === 'COMPLETED' ? '#27d5a0' : undefined }}>
                      {session.fillLevelAfter !== null
                        ? `${session.fillLevelAfter}%`
                        : (session.status === 'COMPLETED' ? '0%' : 'Đang mở')}
                    </strong>
                  </td>
                  <td>{formatDate(session.openedAt, 'Chưa có dữ liệu')}</td>
                  <td>{formatDate(session.closedAt, 'Chưa đóng')}</td>
                  <td>
                    <span style={{ fontSize: '11px', color: '#a0b3c6' }}>
                      {formatTriggerSource(session.triggerSource)}
                    </span>
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
        Hiển thị tối đa 200 phiên thu gom trực tuyến gần nhất từ thiết bị ESP32-C6. Mỗi phiên đại diện cho toàn bộ các thùng của trạm.
      </p>
    </section>
  );
}
