import { useState } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, ProtectedRoute } from './auth';
import { useAuth } from './auth-context';
import { appRoutes } from './route-config';
import { BinDetailPage, BinListPage } from './bins';
import { DeviceListPage } from './devices';
import { AlertsPage, DashboardPage, SensorHistoryPage } from './dashboard';
import { SettingsPage } from './settings';
import { CollectionsPage } from './collections';
import { RealtimeProvider } from './realtime-context';
import { useRealtime } from './realtime-store';
import { ErrorBoundary } from './error-boundary';
import { IconActivity, IconBell, IconCpu, IconGrid, IconHistory, IconMenu, IconSettings, IconTrash } from './icons';
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
  const { token } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const visibleRoutes = appRoutes;
  const currentRoute = [...visibleRoutes].sort((a, b) => b.path.length - a.path.length).find((route) => location.pathname.startsWith(route.path));
  const icons: Record<string, React.ReactNode> = {
    '/dashboard': <IconGrid />,
    '/bins': <IconTrash />,
    '/devices': <IconCpu />,
    '/sensor-history': <IconActivity />,
    '/collections': <IconHistory />,
    '/alerts': <IconBell />,
    '/settings': <IconSettings />
  };

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
            <div className="account-avatar">SB</div>
            <div className="account-copy"><strong>SmartBin Demo</strong><span>Chế độ mô phỏng</span></div>
          </div>
          <button className="collapse-button" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}>
            <span>{collapsed ? '›' : '‹'}</span><span className="collapse-copy">Thu gọn</span>
          </button>
        </aside>

        <main className="workspace">
          <TopBar title={currentRoute?.label ?? 'Tổng quan'} onMenu={() => setSidebarOpen((value) => !value)} />
          <ErrorBoundary key={location.pathname}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/bins" element={<ProtectedRoute><BinListPage /></ProtectedRoute>} />
            <Route path="/bins/:id" element={<ProtectedRoute><BinDetailPage /></ProtectedRoute>} />
            <Route path="/devices" element={<ProtectedRoute><DeviceListPage /></ProtectedRoute>} />
            <Route path="/sensor-history" element={<ProtectedRoute><SensorHistoryPage /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><AlertsPage /></ProtectedRoute>} />
            <Route path="/collections" element={<ProtectedRoute><CollectionsPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/users" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Navigate to="/dashboard" replace />} />

            {appRoutes
              .filter((route) => !['/dashboard', '/bins', '/devices', '/sensor-history', '/alerts', '/collections', '/settings'].includes(route.path))
              .map((route) => (
                <Route key={route.path} path={route.path} element={<ProtectedRoute><PagePlaceholder title={route.label} /></ProtectedRoute>} />
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

  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="icon-button menu-button" type="button" onClick={onMenu} aria-label="Mở menu"><IconMenu /></button>
        <div><span className="breadcrumb">SMARTBIN <span>/</span> VẬN HÀNH</span><strong>{title}</strong></div>
      </div>
      <div className="topbar-actions">
        <div className={`realtime-pill ${connected ? 'is-connected' : 'is-disconnected'}`}><span className="status-dot" />{connected ? 'Realtime connected' : 'Realtime disconnected'}</div>
        <Link className="icon-button notification-link" to="/alerts" aria-label="Mở cảnh báo" title="Cảnh báo"><IconBell /></Link>
        <div className="topbar-user"><span className="account-avatar">SB</span><span><strong>SmartBin</strong><small>Demo Mode</small></span></div>
      </div>
    </header>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Navigate to="/dashboard" replace />} />
          <Route path="/forbidden" element={<ErrorPage code="403" title="Bạn không có quyền truy cập" description="Bạn không có quyền thực hiện hành động này." />} />
          <Route path="/unauthorized" element={<Navigate to="/dashboard" replace />} />
          <Route path="/*" element={<AppShell />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
