import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, LoginPage, ProtectedRoute } from './auth';
import { useAuth, type RoleName } from './auth-context';
import { appRoutes } from './route-config';
import { BinDetailPage, BinListPage } from './bins';
import { DeviceListPage } from './devices';
import { AlertsPage, DashboardPage, SensorHistoryPage } from './dashboard';
import { SettingsPage } from './settings';
import { CollectionsPage } from './collections';
import { UsersPage } from './users';
import { RealtimeProvider } from './realtime-context';
import { useRealtime } from './realtime-store';
import { apiUrl } from './api-config';
import { ErrorBoundary } from './error-boundary';
import {
  IconActivity,
  IconAlertTriangle,
  IconBell,
  IconCpu,
  IconGrid,
  IconHistory,
  IconLogout,
  IconMenu,
  IconSettings,
  IconTrash,
  IconUsers
} from './icons';
import './App.css';

function getUserInitials(name?: string | null): string {
  if (!name || !name.trim()) return 'SB';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getRoleLabel(role?: RoleName, mode?: string): string {
  if (mode === 'demo') return 'Chế độ mô phỏng';
  switch (role) {
    case 'ADMIN':
      return 'Quản trị viên';
    case 'SUPERVISOR':
      return 'Giám sát viên';
    case 'WORKER':
      return 'Nhân viên';
    default:
      return 'Người dùng';
  }
}

function PagePlaceholder({ title }: { title: string }) {
  return (
    <section className="page">
      <div className="eyebrow">TRUNG TÂM ĐIỀU KHIỂN SMARTBIN</div>
      <h1>{title}</h1>
      <p>Chức năng này sẽ được triển khai ở giai đoạn tiếp theo.</p>
    </section>
  );
}

function ErrorPage({ code, title, description }: { code: string; title: string; description: string }) {
  const navigate = useNavigate();

  return (
    <main className="status-page">
      <div className="error-panel">
        <div className="eyebrow">KIỂM SOÁT TRUY CẬP SMARTBIN</div>
        <div className="error-code">{code}</div>
        <h1>{title}</h1>
        <p>{description}</p>
        <button type="button" onClick={() => navigate('/dashboard', { replace: true })}>Về trang tổng quan</button>
      </div>
    </main>
  );
}

function LidAlertBanner() {
  const { socket } = useRealtime();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventRef = useRef<string | null>(null);

  const triggerAlert = useCallback((eventId?: string) => {
    if (eventId && lastEventRef.current === eventId && timerRef.current) {
      return;
    }
    if (eventId) {
      lastEventRef.current = eventId;
    }

    // 1. Hiển thị banner ngay lập tức
    setVisible(true);

    // 2. Nếu đang có bộ đếm 10s chạy dở (sự kiện lỗi mới đến khi đang hiển thị), đặt lại bộ đếm 10s
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 3. Tự động ẩn banner sau đúng 10 giây (10,000ms)
    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, 10000);
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch(`${apiUrl}/api/demo/device-status?_t=${Date.now()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && (data?.data?.lidAlert || data?.lidAlert)) {
          triggerAlert('initial-status');
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [triggerAlert]);

  useEffect(() => {
    if (!socket) return;
    const onLidAlert = (payload: any) => {
      triggerAlert(payload?.eventId || payload?.timestamp || String(Date.now()));
    };
    const onHeartbeat = (payload: any) => {
      // Chỉ kích hoạt nếu có lidAlertId mới
      if (payload?.lidAlert && payload?.lidAlertId && payload?.lidAlertId !== lastEventRef.current) {
        triggerAlert(payload.lidAlertId);
      }
    };
    const onAlertCreated = (payload: any) => {
      if (payload?.message === 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!') {
        triggerAlert(payload?.id || payload?.createdAt || String(Date.now()));
      }
    };

    socket.on('device:lid:alert', onLidAlert);
    socket.on('device:heartbeat', onHeartbeat);
    socket.on('alert:created', onAlertCreated);

    return () => {
      socket.off('device:lid:alert', onLidAlert);
      socket.off('device:heartbeat', onHeartbeat);
      socket.off('alert:created', onAlertCreated);
    };
  }, [socket, triggerAlert]);

  if (!visible) return null;

  return (
    <div className="system-lid-alert-bar" role="alert">
      <IconAlertTriangle />
      <span>CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!</span>
    </div>
  );
}

function AppShell() {
  const { token, user, systemMode } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Danh sách route hiển thị trên navigation:
  // Chỉ giữ lại 4 mục: Tổng quan, Thùng rác, Cảnh báo, Cài đặt
  const visibleRoutes = appRoutes.filter((route) => route.showInNav);

  const currentRoute = [...appRoutes].sort((a, b) => b.path.length - a.path.length).find((route) => location.pathname.startsWith(route.path));

  const icons: Record<string, React.ReactNode> = {
    '/dashboard': <IconGrid />,
    '/bins': <IconTrash />,
    '/devices': <IconCpu />,
    '/sensor-history': <IconActivity />,
    '/collections': <IconHistory />,
    '/alerts': <IconBell />,
    '/settings': <IconSettings />,
    '/users': <IconUsers />
  };

  const userDisplayName = user?.displayName || user?.username || (systemMode === 'demo' ? 'SmartBin Demo' : 'Khách xem');
  const roleLabel = user ? getRoleLabel(user.role, systemMode) : 'Xem công khai';
  const initials = user ? getUserInitials(userDisplayName) : 'SB';

  return (
    <RealtimeProvider token={token}>
      <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}${sidebarOpen ? ' app-shell--menu-open' : ''}`}>
        <button className="sidebar-scrim" type="button" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)} />
        <aside className="sidebar">
          <Link className="brand" to="/dashboard" onClick={() => setSidebarOpen(false)}>
            <span className="brand-mark">S</span><span className="brand-word">SMART<span>BIN</span><small>SMART WASTE MANAGEMENT</small></span>
          </Link>
          <div className="sidebar-label">Không gian vận hành</div>
          <nav aria-label="Điều hướng chính">
            {visibleRoutes.map((route) => (
              <NavLink key={route.path} to={route.path} onClick={() => setSidebarOpen(false)} title={route.label}>
                {icons[route.path]}<span>{route.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="account-avatar">{initials}</div>
            <div className="account-copy"><strong>{userDisplayName}</strong><span>{roleLabel}</span></div>
          </div>
          <button className="collapse-button" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}>
            <span>{collapsed ? '›' : '‹'}</span><span className="collapse-copy">Thu gọn</span>
          </button>
        </aside>

        <main className="workspace">
          <TopBar title={currentRoute?.label ?? 'Tổng quan'} onMenu={() => setSidebarOpen((value) => !value)} />
          <LidAlertBanner />
          <ErrorBoundary key={location.pathname}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/bins" element={<BinListPage />} />
            <Route path="/bins/:id" element={<BinDetailPage />} />
            <Route path="/devices" element={<DeviceListPage />} />
            <Route path="/sensor-history" element={<SensorHistoryPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/users" element={<ProtectedRoute roles={['ADMIN']}><UsersPage /></ProtectedRoute>} />
            <Route path="/login" element={<LoginPage />} />

            {appRoutes
              .filter((route) => !['/dashboard', '/bins', '/devices', '/sensor-history', '/alerts', '/collections', '/settings', '/users'].includes(route.path))
              .map((route) => (
                <Route key={route.path} path={route.path} element={<PagePlaceholder title={route.label} />} />
              ))}
          </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </RealtimeProvider>
  );
}

function TopBar({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { connected } = useRealtime();
  const { user, systemMode, logout } = useAuth();

  const userDisplayName = user?.displayName || user?.username || (systemMode === 'demo' ? 'SmartBin' : 'Người dùng');
  const roleLabel = getRoleLabel(user?.role, systemMode);
  const initials = getUserInitials(userDisplayName);

  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="icon-button menu-button" type="button" onClick={onMenu} aria-label="Mở menu"><IconMenu /></button>
        <div><span className="breadcrumb">SMARTBIN <span>/</span> VẬN HÀNH</span><strong>{title}</strong></div>
      </div>
      <div className="topbar-actions">
        {/* Dynamic Mode Badge */}
        {systemMode === 'demo' ? (
          <div className="realtime-pill" title="Hệ thống đang chạy chế độ mô phỏng dữ liệu" style={{ borderColor: '#ca8a04', color: '#fef08a' }}>
            <span className="status-dot" style={{ background: '#eab308', boxShadow: '0 0 0 3px rgba(234, 179, 8, 0.25)' }} />
            Demo Mode
          </div>
        ) : (
          <div className="realtime-pill is-connected" title="Hệ thống vận hành với cơ sở dữ liệu PostgreSQL thực tế">
            <span className="status-dot" />
            Production
          </div>
        )}

        {/* Realtime Socket Connection Pill */}
        <div className={`realtime-pill ${connected ? 'is-connected' : 'is-disconnected'}`}>
          <span className="status-dot" />
          {connected ? 'Realtime connected' : 'Realtime disconnected'}
        </div>

        {/* Notifications */}
        <Link className="icon-button notification-link" to="/alerts" aria-label="Mở cảnh báo" title="Cảnh báo">
          <IconBell />
        </Link>

        {/* User Account Info */}
        <div className="topbar-user" title={`Tài khoản: ${userDisplayName} (${roleLabel})`}>
          <span className="account-avatar">{initials}</span>
          <span><strong>{userDisplayName}</strong><small>{roleLabel}</small></span>
        </div>

        {/* Logout button */}
        {systemMode === 'production' && user && (
          <button
            className="icon-button"
            type="button"
            onClick={logout}
            title="Đăng xuất khỏi hệ thống"
            aria-label="Đăng xuất"
            style={{ color: '#ef4444' }}
          >
            <IconLogout />
          </button>
        )}
      </div>
    </header>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forbidden" element={<ErrorPage code="403" title="Bạn không có quyền truy cập" description="Tài khoản của bạn không có quyền thực hiện hành động này." />} />
          <Route path="/unauthorized" element={<Navigate to="/login" replace />} />
          <Route path="/*" element={<AppShell />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
