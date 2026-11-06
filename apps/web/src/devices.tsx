import { useState } from 'react';
import { useRealtime } from './realtime-store';
import { IconRefresh } from './icons';
import { RealDeviceCard } from './real-device-card';

export function DeviceListPage() {
  const { connected } = useRealtime();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshTrigger((k) => k + 1);
    setTimeout(() => setRefreshing(false), 500);
  };

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
          <button
            type="button"
            className={`button-secondary refresh-button${refreshing ? ' is-refreshing' : ''}`}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Làm mới dữ liệu"
          >
            <IconRefresh /> Làm mới
          </button>
        </div>
      </div>

      {/* Real Hardware Telemetry */}
      <RealDeviceCard refreshTrigger={refreshTrigger} />
    </section>
  );
}
