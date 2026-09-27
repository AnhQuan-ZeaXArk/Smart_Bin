import { useState, useEffect, useCallback, useMemo } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './auth-context';
import {
  IconCpu,
  IconCamera,
  IconRadio,
  IconServer,
  IconCheckCircle,
  IconAlertTriangle,
  IconXCircle,
  IconRefresh,
  IconClose,
  IconActivity,
  IconInfo
} from './icons';
import {
  type DeviceType,
  type DeviceStatusEnum,
  type DeviceItem,
  type DeviceHealthDetail,
  DEVICE_TYPE_LABELS,
  STATUS_LABELS,
  formatDateTime,
  formatUptime
} from './device-utils';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

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

export function DeviceListPage() {
  const { token } = useAuth();
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DeviceItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deviceDetail, setDeviceDetail] = useState<DeviceHealthDetail | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | DeviceType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | DeviceStatusEnum>('ALL');

  const fetchDevices = useCallback(async () => {
    if (!token) return;
    try {
      setError('');
      const res = await fetch(`${apiUrl}/api/devices`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error('Không thể tải trạng thái thiết bị.');
      }
      const data = await res.json();
      setDevices(data.devices || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải trạng thái thiết bị.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    if (token) {
      fetch(`${apiUrl}/api/devices`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((res) => {
          if (!res.ok) throw new Error('Không thể tải trạng thái thiết bị.');
          return res.json();
        })
        .then((data) => {
          if (active) setDevices(data.devices || []);
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : 'Không thể tải trạng thái thiết bị.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [token]);

  // Realtime Socket.IO subscription
  useEffect(() => {
    if (!token) return;

    let socket: Socket | null = io(apiUrl, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', () => {
      setConnected(false);
    });

    socket.on('device:status', (updated: DeviceItem) => {
      setDevices((prev) => {
        const index = prev.findIndex(
          (d) => d.deviceId === updated.deviceId || d.id === updated.id
        );
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...next[index], ...updated };
          return next;
        }
        return [...prev, updated];
      });

      setSelectedDevice((curr) => {
        if (curr && (curr.deviceId === updated.deviceId || curr.id === updated.id)) {
          return { ...curr, ...updated };
        }
        return curr;
      });

      setDeviceDetail((curr) => {
        if (curr && (curr.deviceId === updated.deviceId)) {
          return { ...curr, ...updated };
        }
        return curr;
      });
    });

    return () => {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
    };
  }, [token]);

  // Open detail modal and fetch health endpoint
  const openDetail = async (device: DeviceItem) => {
    setSelectedDevice(device);
    setDetailLoading(true);
    setDeviceDetail(null);
    try {
      const res = await fetch(`${apiUrl}/api/devices/${device.deviceId}/health`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDeviceDetail(data);
      } else {
        setDeviceDetail({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          deviceType: device.deviceType,
          status: device.status,
          lastSeen: device.lastSeen,
          lastHeartbeat: device.lastHeartbeat,
          uptime: device.uptime,
          firmwareVersion: device.firmwareVersion,
          ipAddress: device.ipAddress,
          metadata: device.metadata ? JSON.parse(device.metadata) : null
        });
      }
    } catch {
      setDeviceDetail({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        status: device.status,
        lastSeen: device.lastSeen,
        lastHeartbeat: device.lastHeartbeat,
        uptime: device.uptime,
        firmwareVersion: device.firmwareVersion,
        ipAddress: device.ipAddress,
        metadata: null
      });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedDevice(null);
    setDeviceDetail(null);
  };

  // Filtered devices
  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      if (typeFilter !== 'ALL' && device.deviceType !== typeFilter) return false;
      if (statusFilter !== 'ALL' && device.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesName = device.deviceName.toLowerCase().includes(q);
        const matchesId = device.deviceId.toLowerCase().includes(q);
        const matchesType = (DEVICE_TYPE_LABELS[device.deviceType] || '').toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesType) return false;
      }
      return true;
    });
  }, [devices, typeFilter, statusFilter, search]);

  // Statistics
  const stats = useMemo(() => {
    return {
      total: devices.length,
      online: devices.filter((d) => d.status === 'ONLINE').length,
      warning: devices.filter((d) => d.status === 'WARNING').length,
      offline: devices.filter((d) => d.status === 'OFFLINE').length
    };
  }, [devices]);

  if (loading) {
    return (
      <section className="page device-page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">GIÁM SÁT HỆ THỐNG</div>
            <h1>Theo dõi thiết bị</h1>
            <p>Tình trạng kết nối và sức khỏe phần cứng IoT theo thời gian thực.</p>
          </div>
        </div>
        <div className="empty-state">
          <p>Đang tải trạng thái thiết bị...</p>
        </div>
      </section>
    );
  }

  if (error && devices.length === 0) {
    return (
      <section className="page device-page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">GIÁM SÁT HỆ THỐNG</div>
            <h1>Theo dõi thiết bị</h1>
            <p>Tình trạng kết nối và sức khỏe phần cứng IoT theo thời gian thực.</p>
          </div>
        </div>
        <div className="empty-state error-state">
          <p>Không thể tải trạng thái thiết bị.</p>
          <span>{error}</span>
          <button type="button" className="button-secondary" onClick={() => void fetchDevices()} style={{ marginTop: '14px' }}>
            <IconRefresh /> Thử lại
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page device-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">GIÁM SÁT HỆ THỐNG</div>
          <h1>Theo dõi thiết bị</h1>
          <p>Tình trạng kết nối và sức khỏe phần cứng IoT theo thời gian thực.</p>
        </div>
        <div className="header-actions-right">
          <div className={`realtime-indicator ${connected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot" />
            {connected ? 'Realtime: Đã kết nối' : 'Realtime: Mất kết nối'}
          </div>
          <button type="button" className="button-secondary" onClick={() => void fetchDevices()} title="Làm mới dữ liệu">
            <IconRefresh /> Làm mới
          </button>
        </div>
      </div>

      {/* Summary KPI Grid */}
      <div className="summary-grid device-summary-grid">
        <div className="summary-card">
          <span>Tổng số thiết bị</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="summary-card">
          <span>Đang hoạt động</span>
          <strong className="text-success">{stats.online}</strong>
        </div>
        <div className="summary-card warning">
          <span>Cần kiểm tra</span>
          <strong className="text-warning">{stats.warning}</strong>
        </div>
        <div className="summary-card critical">
          <span>Mất kết nối</span>
          <strong className="text-danger">{stats.offline}</strong>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="filter-bar device-filter-bar">
        <div className="search-field">
          <label>
            Tìm kiếm thiết bị
            <input
              type="text"
              placeholder="Nhập tên, mã thiết bị hoặc loại..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        <label>
          Loại thiết bị
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
            <option value="ALL">Tất cả loại</option>
            <option value="RASPBERRY_PI">Raspberry Pi 5</option>
            <option value="ULTRASONIC_SENSOR">Cảm biến siêu âm</option>
            <option value="CAMERA">Camera AI</option>
            <option value="MQTT">MQTT Broker</option>
          </select>
        </label>

        <label>
          Trạng thái
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="ALL">Tất cả trạng thái</option>
            <option value="ONLINE">Đang hoạt động</option>
            <option value="WARNING">Cần kiểm tra</option>
            <option value="OFFLINE">Mất kết nối</option>
          </select>
        </label>
      </div>

      {/* Device Cards Grid */}
      {filteredDevices.length === 0 ? (
        <div className="empty-state">
          <p>Không có thiết bị.</p>
        </div>
      ) : (
        <div className="device-cards-grid">
          {filteredDevices.map((device) => (
            <div
              key={device.id}
              className={`device-card device-card--${device.status.toLowerCase()}`}
              onClick={() => void openDetail(device)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  void openDetail(device);
                }
              }}
            >
              <div className="device-card__header">
                <div className="device-card__icon-wrap">
                  {getDeviceIcon(device.deviceType)}
                </div>
                <div className="device-card__title-wrap">
                  <h3>{device.deviceName}</h3>
                  <span className="device-id-code">{device.deviceId}</span>
                </div>
                <div className="device-card__badge-wrap">
                  {getStatusBadge(device.status)}
                </div>
              </div>

              <div className="device-card__body">
                <div className="device-info-row">
                  <span className="info-label">Loại thiết bị:</span>
                  <strong className="info-val">{DEVICE_TYPE_LABELS[device.deviceType] || device.deviceType}</strong>
                </div>
                <div className="device-info-row">
                  <span className="info-label">Lần hoạt động cuối:</span>
                  <span className="info-val">{formatDateTime(device.lastSeen)}</span>
                </div>
                <div className="device-info-row">
                  <span className="info-label">Heartbeat cuối:</span>
                  <span className="info-val">{formatDateTime(device.lastHeartbeat)}</span>
                </div>
                <div className="device-info-row">
                  <span className="info-label">Địa chỉ IP:</span>
                  <span className="info-val info-val--mono">{device.ipAddress || 'Chưa có dữ liệu'}</span>
                </div>
                <div className="device-info-row">
                  <span className="info-label">Uptime:</span>
                  <span className="info-val">{formatUptime(device.uptime)}</span>
                </div>
                <div className="device-info-row">
                  <span className="info-label">Firmware:</span>
                  <span className="info-val">{device.firmwareVersion || 'Chưa có dữ liệu'}</span>
                </div>
              </div>

              <div className="device-card__footer">
                <button
                  type="button"
                  className="button-detail-view"
                  onClick={(e) => {
                    e.stopPropagation();
                    void openDetail(device);
                  }}
                >
                  <IconInfo /> Xem chi tiết
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Device Detail Modal */}
      {selectedDevice && (
        <div className="modal-backdrop" onClick={closeDetail}>
          <div className="modal device-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <div className="eyebrow">THÔNG TIN CHI TIẾT THIẾT BỊ</div>
                <h2>{selectedDevice.deviceName}</h2>
                <div className="modal-subheading">
                  <span className="device-id-code">{selectedDevice.deviceId}</span>
                  <span className="dot-divider">•</span>
                  <span>{DEVICE_TYPE_LABELS[selectedDevice.deviceType]}</span>
                </div>
              </div>
              <button type="button" className="close-button" onClick={closeDetail} title="Đóng">
                <IconClose />
              </button>
            </div>

            {detailLoading ? (
              <div className="modal-loading">Đang tải thông số kỹ thuật...</div>
            ) : (
              <div className="device-detail-content">
                <div className="detail-status-banner">
                  <div className="banner-status-info">
                    <span className="banner-label">Trạng thái hiện tại:</span>
                    <div className="banner-badge-wrap">
                      {getStatusBadge(deviceDetail?.status || selectedDevice.status)}
                    </div>
                  </div>
                  {deviceDetail?.health && (
                    <div className="banner-thresholds">
                      <small>Ngưỡng cấu hình: Online &lt; {deviceDetail.health.onlineThresholdMs / 1000}s | Warning &lt; {deviceDetail.health.offlineThresholdMs / 1000}s | Offline &ge; {deviceDetail.health.offlineThresholdMs / 1000}s</small>
                    </div>
                  )}
                </div>

                <div className="detail-specs-grid">
                  <div className="spec-item">
                    <span className="spec-label">Mã thiết bị (Device ID)</span>
                    <strong className="spec-value spec-value--mono">{selectedDevice.deviceId}</strong>
                  </div>

                  <div className="spec-item">
                    <span className="spec-label">Loại thiết bị</span>
                    <strong className="spec-value">{DEVICE_TYPE_LABELS[selectedDevice.deviceType]}</strong>
                  </div>

                  <div className="spec-item">
                    <span className="spec-label">Địa chỉ IP</span>
                    <strong className="spec-value spec-value--mono">
                      {deviceDetail?.ipAddress || selectedDevice.ipAddress || 'Chưa có dữ liệu'}
                    </strong>
                  </div>

                  <div className="spec-item">
                    <span className="spec-label">Thời gian hoạt động (Uptime)</span>
                    <strong className="spec-value">
                      {formatUptime(deviceDetail?.uptime ?? selectedDevice.uptime)}
                    </strong>
                  </div>

                  <div className="spec-item">
                    <span className="spec-label">Phiên bản Firmware</span>
                    <strong className="spec-value">
                      {deviceDetail?.firmwareVersion || selectedDevice.firmwareVersion || 'Chưa có dữ liệu'}
                    </strong>
                  </div>

                  <div className="spec-item">
                    <span className="spec-label">Lần hoạt động cuối (Last seen)</span>
                    <strong className="spec-value">
                      {formatDateTime(deviceDetail?.lastSeen || selectedDevice.lastSeen)}
                    </strong>
                  </div>

                  <div className="spec-item">
                    <span className="spec-label">Heartbeat cuối</span>
                    <strong className="spec-value">
                      {formatDateTime(deviceDetail?.lastHeartbeat || selectedDevice.lastHeartbeat)}
                    </strong>
                  </div>

                  <div className="spec-item spec-item--full">
                    <span className="spec-label">Dữ liệu bổ sung (Metadata)</span>
                    {(() => {
                      const meta = deviceDetail?.metadata || (selectedDevice.metadata ? JSON.parse(selectedDevice.metadata) : null);
                      if (!meta || Object.keys(meta).length === 0) {
                        return <span className="spec-value text-muted">Chưa có dữ liệu</span>;
                      }
                      return (
                        <pre className="metadata-pre">
                          {JSON.stringify(meta, null, 2)}
                        </pre>
                      );
                    })()}
                  </div>
                </div>

                <div className="modal-actions">
                  <button type="button" className="button-secondary" onClick={closeDetail}>
                    Đóng
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
