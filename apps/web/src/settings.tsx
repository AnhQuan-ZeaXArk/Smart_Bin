import { useEffect, useRef, useState } from 'react';
import { useRealtime } from './realtime-store';
import { useAuth } from './auth-context';
import { apiUrl } from './api-config';
import {
  DEFAULT_THRESHOLDS,
  readSmartBinThresholds,
  saveSmartBinThresholds,
  validateSmartBinThresholds,
  type SmartBinThresholds
} from './threshold-config';

type NotificationConfig = {
  nearFull: boolean;
  full: boolean;
  offline: boolean;
};

type DemoSettings = {
  systemName: string;
  systemDescription: string;
  updateMode: string;
  warningThreshold: number;
  nearFullThreshold: number;
  fullThreshold: number;
  notifications: NotificationConfig;
  deviceConnected: boolean;
  updateFrequency: string;
};

const defaultSettings: DemoSettings = {
  systemName: 'SmartBin',
  systemDescription: 'Hệ thống thùng rác thông minh',
  updateMode: 'Thời gian thực',
  warningThreshold: DEFAULT_THRESHOLDS.warningThreshold,
  nearFullThreshold: DEFAULT_THRESHOLDS.nearFullThreshold,
  fullThreshold: DEFAULT_THRESHOLDS.fullThreshold,
  notifications: { nearFull: true, full: true, offline: true },
  deviceConnected: true,
  updateFrequency: 'Theo dữ liệu cảm biến'
};

function readSettings(): DemoSettings {
  try {
    const savedThresholds = readSmartBinThresholds();
    const raw = localStorage.getItem('smartbin-demo-settings');
    if (!raw) return { ...defaultSettings, ...savedThresholds };
    const parsed = JSON.parse(raw);
    const mergedThresholds: SmartBinThresholds = {
      warningThreshold: Number(parsed.warningThreshold ?? savedThresholds.warningThreshold),
      nearFullThreshold: Number(parsed.nearFullThreshold ?? savedThresholds.nearFullThreshold),
      fullThreshold: Number(parsed.fullThreshold ?? savedThresholds.fullThreshold)
    };
    return {
      ...defaultSettings,
      ...parsed,
      ...mergedThresholds,
      notifications: { ...defaultSettings.notifications, ...(parsed.notifications ?? {}) }
    };
  } catch {
    return { ...defaultSettings, ...readSmartBinThresholds() };
  }
}

function validateThresholds(value: DemoSettings) {
  return validateSmartBinThresholds({
    warningThreshold: value.warningThreshold,
    nearFullThreshold: value.nearFullThreshold,
    fullThreshold: value.fullThreshold
  });
}

export function SettingsPage() {
  const { socket, connected: realtimeConnected } = useRealtime();
  const { user, systemMode } = useAuth();
  const [settings, setSettings] = useState<DemoSettings>(() => readSettings());
  const [status, setStatus] = useState('');
  const [thresholdError, setThresholdError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [remoteNotice, setRemoteNotice] = useState('');
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const latestThresholdsTimestampRef = useRef<number>(0);

  useEffect(() => {
    const handleConnectionChange = () => setIsOnline(window.navigator.onLine);
    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);
    return () => {
      window.removeEventListener('online', handleConnectionChange);
      window.removeEventListener('offline', handleConnectionChange);
    };
  }, []);

  // 1. Tải cấu hình từ PostgreSQL khi khởi tạo trang và khi Socket.IO khôi phục kết nối
  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/api/settings/thresholds`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data?.thresholds) return;
        const t = data.thresholds;
        const incomingTime = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
        // Chống race condition: bỏ qua response HTTP cũ nếu đã nhận cấu hình mới hơn qua Socket.IO
        if (incomingTime && incomingTime < latestThresholdsTimestampRef.current) {
          return;
        }
        if (incomingTime) {
          latestThresholdsTimestampRef.current = incomingTime;
        }

        const nextThresholds: SmartBinThresholds = {
          warningThreshold: Number(t.warningThreshold ?? DEFAULT_THRESHOLDS.warningThreshold),
          nearFullThreshold: Number(t.nearFullThreshold ?? DEFAULT_THRESHOLDS.nearFullThreshold),
          fullThreshold: Number(t.fullThreshold ?? DEFAULT_THRESHOLDS.fullThreshold)
        };
        setSettings((current) => ({
          ...current,
          ...nextThresholds
        }));
        saveSmartBinThresholds(nextThresholds);
      })
      .catch(() => {
        // Khi mất kết nối máy chủ, giữ nguyên cấu hình hiện tại
      });

    return () => {
      active = false;
    };
  }, [realtimeConnected]);

  // 2. Lắng nghe sự kiện Socket.IO đồng bộ realtime giữa nhiều người dùng
  useEffect(() => {
    if (!socket) return;

    const handleThresholdsUpdated = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as Record<string, unknown>;
      const incomingTime = p.updatedAt ? new Date(String(p.updatedAt)).getTime() : Date.now();
      // Chống race condition: bỏ qua event nếu đã xử lý phiên bản mới hơn
      if (incomingTime && incomingTime < latestThresholdsTimestampRef.current) {
        return;
      }
      latestThresholdsTimestampRef.current = incomingTime;

      const nextThresholds: SmartBinThresholds = {
        warningThreshold: Number(p.warningThreshold),
        nearFullThreshold: Number(p.nearFullThreshold),
        fullThreshold: Number(p.fullThreshold)
      };

      if (
        !Number.isFinite(nextThresholds.warningThreshold) ||
        !Number.isFinite(nextThresholds.nearFullThreshold) ||
        !Number.isFinite(nextThresholds.fullThreshold)
      ) {
        return;
      }

      setSettings((current) => ({
        ...current,
        ...nextThresholds
      }));
      setThresholdError('');
      saveSmartBinThresholds(nextThresholds);
      setRemoteNotice('Cấu hình đã được cập nhật bởi một thiết bị khác.');
    };

    socket.on('settings:thresholds:updated', handleThresholdsUpdated);
    socket.on('settings:thresholds', handleThresholdsUpdated);

    return () => {
      socket.off('settings:thresholds:updated', handleThresholdsUpdated);
      socket.off('settings:thresholds', handleThresholdsUpdated);
    };
  }, [socket]);

  const isWorker = systemMode !== 'demo' && user?.role === 'WORKER';
  const canEdit = !isWorker;

  function updateField<K extends keyof DemoSettings>(key: K, value: DemoSettings[K]) {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      setThresholdError(validateThresholds(next));
      return next;
    });
    setRemoteNotice('');
  }

  function updateNotification(key: keyof NotificationConfig, value: boolean) {
    setSettings((current) => ({
      ...current,
      notifications: { ...current.notifications, [key]: value }
    }));
  }

  async function saveSettings() {
    const validation = validateThresholds(settings);
    if (validation) {
      setThresholdError(validation);
      return;
    }

    const nextThresholds: SmartBinThresholds = {
      warningThreshold: settings.warningThreshold,
      nearFullThreshold: settings.nearFullThreshold,
      fullThreshold: settings.fullThreshold
    };

    setThresholdError('');
    setStatus('');
    setRemoteNotice('');
    setIsSaving(true);

    try {
      // Gửi yêu cầu cập nhật lên Backend lưu vào PostgreSQL
      const response = await fetch(`${apiUrl}/api/settings/thresholds`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextThresholds)
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.message || 'Không thể lưu cấu hình lên máy chủ.');
      }

      const saved: SmartBinThresholds = result?.thresholds
        ? {
            warningThreshold: Number(result.thresholds.warningThreshold),
            nearFullThreshold: Number(result.thresholds.nearFullThreshold),
            fullThreshold: Number(result.thresholds.fullThreshold)
          }
        : nextThresholds;

      setSettings((current) => ({
        ...current,
        ...saved
      }));

      const savedTime = result?.thresholds?.updatedAt ? new Date(result.thresholds.updatedAt).getTime() : Date.now();
      latestThresholdsTimestampRef.current = savedTime;

      saveSmartBinThresholds(saved);
      localStorage.setItem('smartbin-demo-settings', JSON.stringify({ ...settings, ...saved }));
      setStatus('Lưu cấu hình thành công vào cơ sở dữ liệu PostgreSQL.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Lỗi kết nối khi lưu cấu hình.';
      setThresholdError(msg);
    } finally {
      setIsSaving(false);
    }
  }

  const connectionText = isOnline ? 'Trình duyệt trực tuyến' : 'Trình duyệt ngoại tuyến';

  return (
    <section className="page settings-page">
      <header className="settings-header">
        <div className="eyebrow">CÀI ĐẶT HỆ THỐNG</div>
        <h1 className="settings-title">Cài đặt</h1>
        <p className="settings-subtitle">
          {systemMode === 'production'
            ? 'Cấu hình hệ thống SmartBin, ngưỡng cảnh báo và thông số vận hành thực tế.'
            : 'Cấu hình hệ thống SmartBin, ngưỡng cảnh báo và thông tin vận hành Demo.'}
        </p>
      </header>

      <div className="settings-shell">
        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h2 className="settings-card__title">1. Cài đặt hệ thống</h2>
              <p className="settings-card__description">Thông tin chung của SmartBin.</p>
            </div>
          </div>

          <div className="settings-grid">
            <div className="settings-field">
              <label htmlFor="system-name" className="settings-field__label">Tên hệ thống</label>
              <input id="system-name" className="settings-input" value={settings.systemName} onChange={(event) => updateField('systemName', event.target.value)} disabled={!canEdit} />
            </div>

            <div className="settings-field">
              <label htmlFor="system-description" className="settings-field__label">Mô tả hệ thống</label>
              <input id="system-description" className="settings-input" value={settings.systemDescription} onChange={(event) => updateField('systemDescription', event.target.value)} disabled={!canEdit} />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Lưu cấu hình</span>
              <div className="settings-readonly settings-readonly--status">Đồng bộ máy chủ (PostgreSQL)</div>
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Chế độ cập nhật</span>
              <div className="settings-readonly">{settings.updateMode}</div>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h2 className="settings-card__title">2. Ngưỡng cảnh báo mức độ đầy</h2>
              <p className="settings-card__description">Cảnh báo được kích hoạt khi mức độ đầy chạm các ngưỡng dưới đây.</p>
            </div>
          </div>

          <div className="threshold-grid">
            <div className="threshold-field">
              <div className="threshold-copy">
                <span className="threshold-label">Cảnh báo</span>
                <small>Khởi đầu cảnh báo khi mức độ đầy đạt ngưỡng này.</small>
              </div>
              <div className="range-input-wrap">
                <input type="number" min={0} max={100} className="settings-input range-value" value={settings.warningThreshold} onChange={(event) => updateField('warningThreshold', Number(event.target.value))} disabled={isSaving} />
                <span className="range-unit">%</span>
              </div>
            </div>

            <div className="threshold-field">
              <div className="threshold-copy">
                <span className="threshold-label">Gần đầy</span>
                <small>Hệ thống báo động sớm để lên kế hoạch thu gom.</small>
              </div>
              <div className="range-input-wrap">
                <input type="number" min={0} max={100} className="settings-input range-value" value={settings.nearFullThreshold} onChange={(event) => updateField('nearFullThreshold', Number(event.target.value))} disabled={isSaving} />
                <span className="range-unit">%</span>
              </div>
            </div>

            <div className="threshold-field">
              <div className="threshold-copy">
                <span className="threshold-label">Đầy</span>
                <small>Ngưỡng cần ưu tiên thu gom và nhắc nhở hoạt động.</small>
              </div>
              <div className="range-input-wrap">
                <input type="number" min={0} max={100} className="settings-input range-value" value={settings.fullThreshold} onChange={(event) => updateField('fullThreshold', Number(event.target.value))} disabled={isSaving} />
                <span className="range-unit">%</span>
              </div>
            </div>
          </div>

          {thresholdError && <p className="field-error">{thresholdError}</p>}
          {status && <p className="field-success" style={{ color: '#10b981', marginTop: '10px', fontSize: '14px', fontWeight: 500 }}>{status}</p>}
          {remoteNotice && <p className="field-info" style={{ color: '#3b82f6', marginTop: '10px', fontSize: '13px' }}>ℹ️ {remoteNotice}</p>}

          <div className="settings-footer">
            <button
              type="button"
              className="button-primary"
              onClick={saveSettings}
              disabled={isSaving}
            >
              {isSaving ? 'Đang lưu vào PostgreSQL...' : 'Lưu thay đổi'}
            </button>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h2 className="settings-card__title">3. Thông báo</h2>
            </div>
          </div>

          <div className="toggle-list">
            {[
              { key: 'nearFull', title: 'Thông báo khi ngăn rác gần đầy', description: 'Gửi nhắc nhở khi mức độ đầy tiến gần ngưỡng cảnh báo.' },
              { key: 'full', title: 'Thông báo khi ngăn rác đầy', description: 'Cảnh báo ưu tiên khi ngăn cần thu gom.' },
              { key: 'offline', title: 'Thông báo khi thiết bị ngoại tuyến', description: 'Nhắc nhở khi mất kết nối với thiết bị IoT.' }
            ].map((option) => (
              <div className="toggle-row" key={option.key}>
                <div className="toggle-copy">
                  <strong>{option.title}</strong>
                  <span>{option.description}</span>
                </div>
                <label className="switch" aria-label={option.title}>
                  <input type="checkbox" checked={settings.notifications[option.key as keyof NotificationConfig]} onChange={(event) => updateNotification(option.key as keyof NotificationConfig, event.target.checked)} disabled={!canEdit} />
                  <span className="slider" />
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h2 className="settings-card__title">4. Kết nối thời gian thực</h2>
              <p className="settings-card__description">Theo dõi trạng thái kết nối và cập nhật dữ liệu.</p>
            </div>
          </div>

          <div className="settings-grid">
            <div className="settings-field">
              <span className="settings-field__label">Kết nối</span>
              <div className={`settings-readonly ${isOnline ? 'settings-readonly--success' : 'settings-readonly--warning'}`}><span className="status-dot" />{connectionText}</div>
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Socket.IO</span>
              <div className={`settings-readonly ${realtimeConnected ? 'settings-readonly--success' : 'settings-readonly--warning'}`}><span className="status-dot" />{realtimeConnected ? 'Đã kết nối' : 'Mất kết nối'}</div>
            </div>

            <div className="settings-field settings-field--full">
              <span className="settings-field__label">Cập nhật dữ liệu</span>
              <div className="settings-readonly">{settings.updateFrequency}</div>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h2 className="settings-card__title">5. Thông tin hệ thống</h2>
              <p className="settings-card__description">Thông tin kỹ thuật cơ bản của SmartBin.</p>
            </div>
          </div>

          <div className="settings-grid">
            <div className="settings-field">
              <span className="settings-field__label">Tên hệ thống</span>
              <div className="settings-readonly">SmartBin</div>
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Phiên bản</span>
              <div className="settings-readonly">
                {systemMode === 'production' ? '1.0.0 (Production)' : '1.0.0 (Demo Mode)'}
              </div>
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Số ngăn</span>
              <div className="settings-readonly">3</div>
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Kiến trúc</span>
              <div className="settings-readonly">ESP32 → Raspberry Pi 5 → MQTT → Backend → Web</div>
            </div>

            <div className="settings-field settings-field--full">
              <span className="settings-field__label">Loại rác</span>
              <ul className="settings-list">
                <li>Rác hữu cơ</li>
                <li>Rác tái chế</li>
                <li>Rác không tái chế</li>
              </ul>
            </div>
          </div>
        </section>

        {status && <p className="settings-success">{status}</p>}
      </div>
    </section>
  );
}
