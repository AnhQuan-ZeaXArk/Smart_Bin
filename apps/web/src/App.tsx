import { useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, LoginPage, ProtectedRoute } from './auth';
import { useAuth } from './auth-context';
import { appRoutes } from './route-config';
import { BinDetailPage, BinListPage } from './bins';
import { DeviceListPage } from './devices';
import { AlertsPage, DashboardPage, SensorHistoryPage } from './dashboard';
import { SettingsPage } from './settings';
import { CollectionsPage } from './collections';
import { UsersPage } from './users';
import { RealtimeProvider } from './realtime-context';
import { useRealtime } from './realtime-store';
import { IconActivity, IconBell, IconCpu, IconGrid, IconHistory, IconLogout, IconMenu, IconSettings, IconTrash, IconUsers } from './icons';
import './App.css';

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

function AppShell() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const visibleRoutes = appRoutes.filter((route) => route.roles.includes(user!.role));
  const currentRoute = [...visibleRoutes].sort((a, b) => b.path.length - a.path.length).find((route) => location.pathname.startsWith(route.path));
  const icons: Record<string, React.ReactNode> = {
    '/dashboard': <IconGrid />,
    '/bins': <IconTrash />,
    '/devices': <IconCpu />,
    '/sensor-history': <IconActivity />,
    '/collections': <IconHistory />,
    '/alerts': <IconBell />,
    '/users': <IconUsers />,
    '/settings': <IconSettings />
  };

  function signOut() {
    logout();
    navigate('/login', { replace: true });
  }

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
            <div className="account-avatar">{user!.username.slice(0, 1).toUpperCase()}</div>
            <div className="account-copy"><strong>{user!.username}</strong><span>{user!.role}</span></div>
            <button className="icon-button account-logout" type="button" onClick={signOut} title="Đăng xuất" aria-label="Đăng xuất"><IconLogout /></button>
          </div>
          <button className="collapse-button" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}>
            <span>{collapsed ? '›' : '‹'}</span><span className="collapse-copy">Thu gọn</span>
          </button>
        </aside>

        <main className="workspace">
          <TopBar title={currentRoute?.label ?? 'Tổng quan'} onMenu={() => setSidebarOpen((value) => !value)} />
          <Routes>
            <Route path="/dashboard" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><DashboardPage /></ProtectedRoute>} />
            <Route path="/bins" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><BinListPage /></ProtectedRoute>} />
            <Route path="/bins/:id" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><BinDetailPage /></ProtectedRoute>} />
            <Route path="/devices" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><DeviceListPage /></ProtectedRoute>} />
            <Route path="/sensor-history" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR']}><SensorHistoryPage /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR']}><AlertsPage /></ProtectedRoute>} />
            <Route path="/collections" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><CollectionsPage /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute roles={['ADMIN']}><UsersPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><SettingsPage /></ProtectedRoute>} />

            {appRoutes
              .filter((route) => !['/dashboard', '/bins', '/devices', '/sensor-history', '/alerts', '/collections', '/users', '/settings'].includes(route.path))
              .map((route) => (
                <Route key={route.path} path={route.path} element={<ProtectedRoute roles={route.roles}><PagePlaceholder title={route.label} /></ProtectedRoute>} />
              ))}
          </Routes>
        </main>
      </div>
    </RealtimeProvider>
  );
}

function TopBar({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { user } = useAuth();
  const { connected } = useRealtime();

  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="icon-button menu-button" type="button" onClick={onMenu} aria-label="Mở menu"><IconMenu /></button>
        <div><span className="breadcrumb">SMARTBIN <span>/</span> VẬN HÀNH</span><strong>{title}</strong></div>
      </div>
      <div className="topbar-actions">
        <div className={`realtime-pill ${connected ? 'is-connected' : 'is-disconnected'}`}><span className="status-dot" />{connected ? 'Realtime connected' : 'Realtime disconnected'}</div>
        {user!.role !== 'WORKER' && <Link className="icon-button notification-link" to="/alerts" aria-label="Mở cảnh báo" title="Cảnh báo"><IconBell /></Link>}
        <div className="topbar-user"><span className="account-avatar">{user!.username.slice(0, 1).toUpperCase()}</span><span><strong>{user!.username}</strong><small>{user!.role}</small></span></div>
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
          <Route path="/forbidden" element={<ErrorPage code="403" title="Bạn không có quyền truy cập" description="Bạn không có quyền thực hiện hành động này." />} />
          <Route path="/*" element={<ProtectedRoute><AppShell /></ProtectedRoute>} />
          <Route path="/unauthorized" element={<ErrorPage code="401" title="Yêu cầu đăng nhập" description="Vui lòng đăng nhập để tiếp tục." />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
