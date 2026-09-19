import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from './auth-context';
import {
  DEFAULT_THRESHOLDS,
  readSmartBinThresholds,
  saveSmartBinThresholds,
  validateSmartBinThresholds,
  type SmartBinThresholds
} from './threshold-config';
import { IconShield, IconKey, IconEye, IconEyeOff, IconClose } from './icons';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const ROLE_OPTIONS = ['ADMIN', 'SUPERVISOR', 'WORKER'] as const;

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

type AccountRole = typeof ROLE_OPTIONS[number];

type AccountUser = {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  isActive: boolean;
};

type AccountFormState = {
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
  role: AccountRole;
  isActive: boolean;
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

const defaultAccountForm: AccountFormState = {
  username: '',
  displayName: '',
  password: '',
  confirmPassword: '',
  role: 'WORKER',
  isActive: true
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
  const { user, token } = useAuth();
  const [settings, setSettings] = useState<DemoSettings>(() => readSettings());
  const [status, setStatus] = useState('');
  const [thresholdError, setThresholdError] = useState('');
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [accountUsers, setAccountUsers] = useState<AccountUser[]>([]);
  const [accountError, setAccountError] = useState('');
  const [accountSuccess, setAccountSuccess] = useState('');
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [accountMode, setAccountMode] = useState<'create' | 'edit'>('create');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<AccountFormState>(defaultAccountForm);
  const [changePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordSuccess, setChangePasswordSuccess] = useState('');
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);

  const [adminResetAccount, setAdminResetAccount] = useState<AccountUser | null>(null);
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [showAdminNewPass, setShowAdminNewPass] = useState(false);
  const [showAdminConfirmPass, setShowAdminConfirmPass] = useState(false);
  const [adminResetError, setAdminResetError] = useState('');
  const [adminResetLoading, setAdminResetLoading] = useState(false);

  useEffect(() => {
    const handleConnectionChange = () => setIsOnline(window.navigator.onLine);
    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);
    return () => {
      window.removeEventListener('online', handleConnectionChange);
      window.removeEventListener('offline', handleConnectionChange);
    };
  }, []);

  useEffect(() => {
    async function loadAccountUsers() {
      if (!token || user?.role !== 'ADMIN') {
        setAccountUsers([]);
        return;
      }

      try {
        const response = await fetch(`${apiUrl}/api/users`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const payload = await response.json().catch(() => ({})) as {
          users?: Array<{ id: string; username: string; displayName?: string; role?: string; isActive?: boolean; employee?: { fullName?: string } }>;
        };

        if (!response.ok) {
          throw new Error('Không thể tải danh sách tài khoản.');
        }

        setAccountUsers((payload.users ?? []).map((entry) => ({
          id: entry.id,
          username: entry.username,
          displayName: entry.displayName ?? entry.employee?.fullName ?? entry.username,
          role: ROLE_OPTIONS.includes(entry.role as AccountRole) ? (entry.role as AccountRole) : 'WORKER',
          isActive: entry.isActive ?? true
        })));
      } catch {
        setAccountUsers([]);
      }
    }

    void loadAccountUsers();
  }, [token, user?.role]);

  const canEdit = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';
  const canManageThresholds = user?.role === 'ADMIN';
  const isAdmin = user?.role === 'ADMIN';

  function updateField<K extends keyof DemoSettings>(key: K, value: DemoSettings[K]) {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      setThresholdError(validateThresholds(next));
      return next;
    });
  }

  function updateNotification(key: keyof NotificationConfig, value: boolean) {
    setSettings((current) => ({
      ...current,
      notifications: { ...current.notifications, [key]: value }
    }));
  }

  function saveSettings() {
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
    setStatus('Lưu thay đổi thành công.');
    saveSmartBinThresholds(nextThresholds);
    localStorage.setItem('smartbin-demo-settings', JSON.stringify({ ...settings, ...nextThresholds }));
  }

  async function fetchAccountUsers() {
    if (!token || user?.role !== 'ADMIN') {
      setAccountUsers([]);
      return;
    }

    const response = await fetch(`${apiUrl}/api/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({})) as {
      users?: Array<{ id: string; username: string; displayName?: string; role?: string; isActive?: boolean; employee?: { fullName?: string } }>;
    };

    if (!response.ok) {
      setAccountUsers([]);
      return;
    }

    setAccountUsers((payload.users ?? []).map((entry) => ({
      id: entry.id,
      username: entry.username,
      displayName: entry.displayName ?? entry.employee?.fullName ?? entry.username,
      role: ROLE_OPTIONS.includes(entry.role as AccountRole) ? (entry.role as AccountRole) : 'WORKER',
      isActive: entry.isActive ?? true
    })));
  }

  function openCreateAccount() {
    setAccountMode('create');
    setEditingUserId(null);
    setAccountForm(defaultAccountForm);
    setAccountError('');
    setAccountSuccess('');
    setAccountFormOpen(true);
  }

  function openEditAccount(account: AccountUser) {
    setAccountMode('edit');
    setEditingUserId(account.id);
    setAccountForm({
      username: account.username,
      displayName: account.displayName,
      password: '',
      confirmPassword: '',
      role: account.role,
      isActive: account.isActive
    });
    setAccountError('');
    setAccountSuccess('');
    setAccountFormOpen(true);
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setAccountError('Phiên đăng nhập đã hết hạn.');
      return;
    }

    const username = accountForm.username.trim();
    const displayName = accountForm.displayName.trim();

    if (!username) {
      setAccountError('Tên người dùng không được để trống.');
      return;
    }

    if (!displayName) {
      setAccountError('Tên hiển thị không được để trống.');
      return;
    }

    if (accountMode === 'create' && accountUsers.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
      setAccountError('Tên người dùng đã tồn tại.');
      return;
    }

    if (accountMode === 'create' && !accountForm.password.trim()) {
      setAccountError('Mật khẩu không được để trống.');
      return;
    }

    if (accountForm.password && accountForm.password !== accountForm.confirmPassword) {
      setAccountError('Mật khẩu xác nhận không khớp.');
      return;
    }

    if (!ROLE_OPTIONS.includes(accountForm.role)) {
      setAccountError('Vai trò không hợp lệ.');
      return;
    }

    const body = accountMode === 'create'
      ? {
          username,
          displayName,
          password: accountForm.password,
          confirmPassword: accountForm.confirmPassword,
          role: accountForm.role,
          isActive: accountForm.isActive
        }
      : {
          username,
          displayName,
          role: accountForm.role,
          isActive: accountForm.isActive
        };

    try {
      const response = await fetch(`${apiUrl}/api/users${accountMode === 'edit' && editingUserId ? `/${editingUserId}` : ''}`, {
        method: accountMode === 'edit' ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Không thể lưu tài khoản.');
      }

      setAccountSuccess(accountMode === 'create' ? 'Tạo tài khoản thành công.' : 'Cập nhật tài khoản thành công.');
      setAccountError('');
      setAccountFormOpen(false);
      setAccountForm(defaultAccountForm);
      setEditingUserId(null);
      await fetchAccountUsers();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Không thể lưu tài khoản.');
    }
  }

  function openChangePasswordModal() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPass(false);
    setShowNewPass(false);
    setShowConfirmPass(false);
    setChangePasswordError('');
    setChangePasswordSuccess('');
    setChangePasswordLoading(false);
    setChangePasswordModalOpen(true);
  }

  function closeChangePasswordModal() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setChangePasswordModalOpen(false);
  }

  async function submitChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChangePasswordError('');
    setChangePasswordSuccess('');

    if (!currentPassword.trim()) {
      setChangePasswordError('Mật khẩu hiện tại không được để trống.');
      return;
    }

    if (!newPassword.trim()) {
      setChangePasswordError('Mật khẩu mới không được để trống.');
      return;
    }

    if (newPassword.length < 6) {
      setChangePasswordError('Mật khẩu mới không hợp lệ (yêu cầu tối thiểu 6 ký tự).');
      return;
    }

    if (newPassword === currentPassword) {
      setChangePasswordError('Mật khẩu mới không được trùng với mật khẩu hiện tại.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setChangePasswordError('Xác nhận mật khẩu mới không khớp.');
      return;
    }

    setChangePasswordLoading(true);

    try {
      // Backend API check:
      // Endpoint tự đổi mật khẩu kèm kiểm tra mật khẩu hiện tại chưa tồn tại trên backend.
      // (Backend hiện chỉ có PATCH /api/users/:id/password dành cho quyền ADMIN và không xác thực currentPassword).
      await new Promise((resolve) => setTimeout(resolve, 400));
      setChangePasswordError('Hệ thống hiện tại chưa cấu hình API đổi mật khẩu cá nhân (Backend endpoint xác thực mật khẩu hiện tại chưa tồn tại). Vui lòng liên hệ quản trị viên.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setChangePasswordLoading(false);
    }
  }

  function openAdminResetPassword(account: AccountUser) {
    setAdminResetAccount(account);
    setAdminNewPassword('');
    setAdminConfirmPassword('');
    setShowAdminNewPass(false);
    setShowAdminConfirmPass(false);
    setAdminResetError('');
    setAdminResetLoading(false);
  }

  function closeAdminResetPassword() {
    setAdminResetAccount(null);
    setAdminNewPassword('');
    setAdminConfirmPassword('');
    setAdminResetError('');
  }

  async function submitAdminResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminResetAccount) return;

    if (!adminNewPassword.trim()) {
      setAdminResetError('Mật khẩu mới không được để trống.');
      return;
    }

    if (adminNewPassword.length < 6) {
      setAdminResetError('Mật khẩu mới phải có tối thiểu 6 ký tự.');
      return;
    }

    if (adminNewPassword !== adminConfirmPassword) {
      setAdminResetError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setAdminResetLoading(true);
    setAdminResetError('');

    try {
      const response = await fetch(`${apiUrl}/api/users/${adminResetAccount.id}/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password: adminNewPassword, confirmPassword: adminConfirmPassword })
      });

      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Không thể cập nhật mật khẩu.');
      }

      setAccountSuccess(`Đã đặt lại mật khẩu cho tài khoản "${adminResetAccount.username}".`);
      closeAdminResetPassword();
    } catch (error) {
      setAdminResetError(error instanceof Error ? error.message : 'Không thể cập nhật mật khẩu.');
    } finally {
      setAdminResetLoading(false);
    }
  }

  async function toggleAccountStatus(accountId: string, active: boolean) {
    if (!active && !window.confirm('Bạn có chắc muốn vô hiệu hóa tài khoản này không?')) {
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/api/users/${accountId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isActive: active })
      });

      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? 'Không thể cập nhật trạng thái tài khoản.');
      }

      setAccountError('');
      setAccountSuccess(payload.message ?? 'Cập nhật trạng thái tài khoản thành công.');
      await fetchAccountUsers();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Không thể cập nhật trạng thái tài khoản.');
    }
  }

  const connectionText = isOnline ? 'Đã kết nối' : 'Mất kết nối';

  return (
    <section className="page settings-page">
      <header className="settings-header">
        <div className="eyebrow">CÀI ĐẶT HỆ THỐNG</div>
        <h1 className="settings-title">Cài đặt</h1>
        <p className="settings-subtitle">Cấu hình hệ thống SmartBin, ngưỡng cảnh báo và thông tin tài khoản.</p>
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
              <span className="settings-field__label">Trạng thái hệ thống</span>
              <div className="settings-readonly settings-readonly--status"><span className="status-dot" />Đang hoạt động</div>
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
                <input type="number" min={0} max={100} className="settings-input range-value" value={settings.warningThreshold} onChange={(event) => updateField('warningThreshold', Number(event.target.value))} disabled={!canManageThresholds} />
                <span className="range-unit">%</span>
              </div>
            </div>

            <div className="threshold-field">
              <div className="threshold-copy">
                <span className="threshold-label">Gần đầy</span>
                <small>Hệ thống báo động sớm để lên kế hoạch thu gom.</small>
              </div>
              <div className="range-input-wrap">
                <input type="number" min={0} max={100} className="settings-input range-value" value={settings.nearFullThreshold} onChange={(event) => updateField('nearFullThreshold', Number(event.target.value))} disabled={!canManageThresholds} />
                <span className="range-unit">%</span>
              </div>
            </div>

            <div className="threshold-field">
              <div className="threshold-copy">
                <span className="threshold-label">Đầy</span>
                <small>Ngưỡng cần ưu tiên thu gom và nhắc nhở hoạt động.</small>
              </div>
              <div className="range-input-wrap">
                <input type="number" min={0} max={100} className="settings-input range-value" value={settings.fullThreshold} onChange={(event) => updateField('fullThreshold', Number(event.target.value))} disabled={!canManageThresholds} />
                <span className="range-unit">%</span>
              </div>
            </div>
          </div>

          {thresholdError && <p className="field-error">{thresholdError}</p>}

          {canManageThresholds && (
            <div className="settings-footer">
              <button type="button" className="button-primary" onClick={saveSettings}>Lưu thay đổi</button>
            </div>
          )}
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
              <div className="settings-readonly"><span className="status-dot" />Đang hoạt động bình thường</div>
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
              <h2 className="settings-card__title">5. Tài khoản</h2>
              <p className="settings-card__description">Thông tin quyền truy cập hiện tại.</p>
            </div>
          </div>

          <div className="settings-grid">
            <div className="settings-field">
              <span className="settings-field__label">Tên người dùng</span>
              <div className="settings-readonly">{user?.username ?? 'admin'}</div>
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Vai trò</span>
              <div className="settings-readonly">{user?.role ?? 'ADMIN'}</div>
            </div>
          </div>

          <div className="settings-footer settings-footer--space">
            <button type="button" className="button-secondary" onClick={openChangePasswordModal}>
              <IconKey />
              Đổi mật khẩu
            </button>
            <p className="settings-note">Quản lý mật khẩu sẽ được thực hiện theo quy trình bảo mật của hệ thống.</p>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__header">
            <div>
              <h2 className="settings-card__title">6. Thông tin hệ thống</h2>
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
              <div className="settings-readonly">1.0.0</div>
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

        {isAdmin && (
          <section className="settings-card">
            <div className="settings-card__header">
              <div>
                <h2 className="settings-card__title">7. Quản lý tài khoản</h2>
                <p className="settings-card__description">Quản lý tài khoản đăng nhập và quyền truy cập hệ thống.</p>
              </div>
            </div>

            <div className="settings-footer settings-footer--space">
              <button type="button" className="button-primary" onClick={openCreateAccount}>+ Cấp tài khoản</button>
            </div>

            <div className="account-table-wrap">
              <table className="account-table">
                <thead>
                  <tr>
                    <th>Tên người dùng</th>
                    <th>Tên hiển thị</th>
                    <th>Vai trò</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {accountUsers.length > 0 ? accountUsers.map((account) => (
                    <tr key={account.id}>
                      <td>{account.username}</td>
                      <td>{account.displayName}</td>
                      <td><span className={`role-badge role-badge--${account.role.toLowerCase()}`}>{account.role}</span></td>
                      <td><span className={`account-status ${account.isActive ? 'account-status--active' : 'account-status--inactive'}`}>{account.isActive ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</span></td>
                      <td>
                        <div className="account-actions">
                          <button type="button" className="table-button" onClick={() => openEditAccount(account)}>Chỉnh sửa</button>
                          <button type="button" className="table-button" onClick={() => openAdminResetPassword(account)}>Đổi mật khẩu</button>
                          <button type="button" className="table-button table-button--danger" onClick={() => toggleAccountStatus(account.id, !account.isActive)}>{account.isActive ? 'Vô hiệu hóa' : 'Kích hoạt'}</button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} className="account-empty">Chưa có tài khoản nào được tạo.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {accountError && <p className="field-error">{accountError}</p>}
            {accountSuccess && <p className="settings-success">{accountSuccess}</p>}
          </section>
        )}

        {status && <p className="settings-success">{status}</p>}
      </div>

      {accountFormOpen && (
        <div className="modal-backdrop" onClick={() => setAccountFormOpen(false)}>
          <div className="account-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="eyebrow">QUẢN LÝ TÀI KHOẢN</div>
                <h3>{accountMode === 'create' ? 'Cấp tài khoản' : 'Chỉnh sửa tài khoản'}</h3>
              </div>
              <button type="button" className="close-button" onClick={() => setAccountFormOpen(false)} aria-label="Đóng">×</button>
            </div>

            <form className="account-form" onSubmit={submitAccount}>
              <label>
                <span>Tên người dùng</span>
                <input value={accountForm.username} onChange={(event) => setAccountForm((current) => ({ ...current, username: event.target.value }))} />
              </label>

              <label>
                <span>Tên hiển thị</span>
                <input value={accountForm.displayName} onChange={(event) => setAccountForm((current) => ({ ...current, displayName: event.target.value }))} />
              </label>

              {accountMode === 'create' && (
                <>
                  <label>
                    <span>Mật khẩu</span>
                    <input type="password" value={accountForm.password} onChange={(event) => setAccountForm((current) => ({ ...current, password: event.target.value }))} />
                  </label>

                  <label>
                    <span>Xác nhận mật khẩu</span>
                    <input type="password" value={accountForm.confirmPassword} onChange={(event) => setAccountForm((current) => ({ ...current, confirmPassword: event.target.value }))} />
                  </label>
                </>
              )}

              <label>
                <span>Vai trò</span>
                <select value={accountForm.role} onChange={(event) => setAccountForm((current) => ({ ...current, role: event.target.value as AccountRole }))}>
                  {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>

              <label>
                <span>Trạng thái</span>
                <select value={accountForm.isActive ? 'active' : 'inactive'} onChange={(event) => setAccountForm((current) => ({ ...current, isActive: event.target.value === 'active' }))}>
                  <option value="active">Đang hoạt động</option>
                  <option value="inactive">Đã vô hiệu hóa</option>
                </select>
              </label>

              <div className="modal-actions">
                <button type="button" className="button-secondary" onClick={() => setAccountFormOpen(false)}>Hủy</button>
                <button type="submit" className="button-primary">{accountMode === 'create' ? 'Thêm tài khoản' : 'Lưu thay đổi'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {changePasswordModalOpen && (
        <div className="modal-backdrop" onClick={closeChangePasswordModal}>
          <div className="account-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="change-pw-title">
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-header-icon-box">
                  <IconShield width="22" height="22" />
                </div>
                <div className="modal-title-text">
                  <h3 id="change-pw-title">Đổi mật khẩu</h3>
                  <p>Cập nhật mật khẩu bảo mật cho tài khoản cá nhân.</p>
                </div>
              </div>
              <button type="button" className="close-button" onClick={closeChangePasswordModal} aria-label="Đóng">
                <IconClose />
              </button>
            </div>

            <form className="account-form" onSubmit={submitChangePassword}>
              <label>
                <span>Mật khẩu hiện tại</span>
                <div className="password-input-wrap">
                  <input
                    type={showCurrentPass ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Nhập mật khẩu hiện tại"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowCurrentPass(!showCurrentPass)}
                    aria-label={showCurrentPass ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                  >
                    {showCurrentPass ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </label>

              <label>
                <span>Mật khẩu mới</span>
                <div className="password-input-wrap">
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Tối thiểu 6 ký tự"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowNewPass(!showNewPass)}
                    aria-label={showNewPass ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                  >
                    {showNewPass ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </label>

              <label>
                <span>Xác nhận mật khẩu mới</span>
                <div className="password-input-wrap">
                  <input
                    type={showConfirmPass ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowConfirmPass(!showConfirmPass)}
                    aria-label={showConfirmPass ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                  >
                    {showConfirmPass ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </label>

              {changePasswordError && (
                <p className="modal-alert modal-alert--error">{changePasswordError}</p>
              )}
              {changePasswordSuccess && (
                <p className="modal-alert modal-alert--success">{changePasswordSuccess}</p>
              )}

              <div className="modal-actions">
                <button type="button" className="button-secondary" onClick={closeChangePasswordModal} disabled={changePasswordLoading}>
                  Hủy
                </button>
                <button type="submit" className="button-primary" disabled={changePasswordLoading}>
                  {changePasswordLoading ? 'Đang xử lý...' : 'Đổi mật khẩu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {adminResetAccount && (
        <div className="modal-backdrop" onClick={closeAdminResetPassword}>
          <div className="account-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="admin-reset-pw-title">
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-header-icon-box">
                  <IconKey width="20" height="20" />
                </div>
                <div className="modal-title-text">
                  <h3 id="admin-reset-pw-title">Đặt lại mật khẩu</h3>
                  <p>Tài khoản: <strong>{adminResetAccount.username}</strong> ({adminResetAccount.displayName})</p>
                </div>
              </div>
              <button type="button" className="close-button" onClick={closeAdminResetPassword} aria-label="Đóng">
                <IconClose />
              </button>
            </div>

            <form className="account-form" onSubmit={submitAdminResetPassword}>
              <label>
                <span>Mật khẩu mới</span>
                <div className="password-input-wrap">
                  <input
                    type={showAdminNewPass ? 'text' : 'password'}
                    value={adminNewPassword}
                    onChange={(e) => setAdminNewPassword(e.target.value)}
                    placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowAdminNewPass(!showAdminNewPass)}
                    aria-label={showAdminNewPass ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                  >
                    {showAdminNewPass ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </label>

              <label>
                <span>Xác nhận mật khẩu mới</span>
                <div className="password-input-wrap">
                  <input
                    type={showAdminConfirmPass ? 'text' : 'password'}
                    value={adminConfirmPassword}
                    onChange={(e) => setAdminConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowAdminConfirmPass(!showAdminConfirmPass)}
                    aria-label={showAdminConfirmPass ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
                  >
                    {showAdminConfirmPass ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </label>

              {adminResetError && (
                <p className="modal-alert modal-alert--error">{adminResetError}</p>
              )}

              <div className="modal-actions">
                <button type="button" className="button-secondary" onClick={closeAdminResetPassword} disabled={adminResetLoading}>
                  Hủy
                </button>
                <button type="submit" className="button-primary" disabled={adminResetLoading}>
                  {adminResetLoading ? 'Đang cập nhật...' : 'Xác nhận đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
