import { BrowserRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, LoginPage, ProtectedRoute } from './auth';
import { useAuth } from './auth-context';
import { appRoutes } from './route-config';
import { BinDetailPage, BinListPage } from './bins';
import { EmployeeDetailPage, EmployeeListPage, NfcCardListPage } from './employee-nfc';
import { AccessLogsPage, AlertsPage, DashboardPage, SensorHistoryPage } from './dashboard';
import { SettingsPage } from './settings';
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const visibleRoutes = appRoutes.filter((route) => route.roles.includes(user!.role));

  function signOut() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <aside>
        <div className="brand">SMART<span>BIN</span><small>OPERATIONS</small></div>
        <nav aria-label="Main navigation">
          {visibleRoutes.map((route) => (
            <NavLink key={route.path} to={route.path}>{route.label}</NavLink>
          ))}
        </nav>
      </aside>

      <main>
        <header>
          <div><span className="status-dot" /> Phiên đăng nhập hợp lệ</div>
          <div className="header-actions">
            <div className="user-summary">
              <strong>{user!.username}</strong>
              <span>Vai trò: {user!.role}</span>
            </div>
            <button className="logout-button" type="button" onClick={signOut}>Đăng xuất</button>
          </div>
        </header>

        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><DashboardPage /></ProtectedRoute>} />
          <Route path="/bins" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><BinListPage /></ProtectedRoute>} />
          <Route path="/bins/:id" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><BinDetailPage /></ProtectedRoute>} />
          <Route path="/employees" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><EmployeeListPage /></ProtectedRoute>} />
          <Route path="/employees/:id" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><EmployeeDetailPage /></ProtectedRoute>} />
          <Route path="/nfc-cards" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><NfcCardListPage /></ProtectedRoute>} />
          <Route path="/sensor-history" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR']}><SensorHistoryPage /></ProtectedRoute>} />
          <Route path="/access-logs" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR']}><AccessLogsPage /></ProtectedRoute>} />
          <Route path="/alerts" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR']}><AlertsPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute roles={['ADMIN', 'SUPERVISOR', 'WORKER']}><SettingsPage /></ProtectedRoute>} />

          {appRoutes
            .filter((route) => !['/dashboard', '/bins', '/employees', '/nfc-cards', '/sensor-history', '/access-logs', '/alerts', '/settings'].includes(route.path))
            .map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={
                  <ProtectedRoute roles={route.roles}>
                    <PagePlaceholder title={route.label} />
                  </ProtectedRoute>
                }
              />
            ))}
        </Routes>
      </main>
    </div>
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
