import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext, useAuth, type RoleName, type SessionUser } from './auth-context';
interface LoginResponse { token?: string; user?: SessionUser; message?: string; }
interface MeResponse { id: string; username: string; role: RoleName; }
const tokenKey = 'smartbin.auth.token';
const userKey = 'smartbin.auth.user';
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function readStoredUser(): SessionUser | null {
  try {
    const stored = localStorage.getItem(userKey);
    return stored ? JSON.parse(stored) as SessionUser : null;
  } catch {
    localStorage.removeItem(userKey);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey));
  const [user, setUser] = useState<SessionUser | null>(readStoredUser);
  const [sessionReady, setSessionReady] = useState(() => !localStorage.getItem(tokenKey));

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session expired');
        return response.json() as Promise<MeResponse>;
      })
      .then((currentUser) => { if (!cancelled) { setUser({ id: currentUser.id, username: currentUser.username, role: currentUser.role }); setSessionReady(true); } })
      .catch(() => { if (!cancelled) { setToken(null); setUser(null); setSessionReady(true); } });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (token) localStorage.setItem(tokenKey, token); else localStorage.removeItem(tokenKey);
    if (user) localStorage.setItem(userKey, JSON.stringify(user)); else localStorage.removeItem(userKey);
  }, [token, user]);

  async function login(username: string, password: string) {
    const response = await fetch(`${apiUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const payload = await response.json() as LoginResponse;
    if (!response.ok || !payload.token || !payload.user) throw new Error(payload.message ?? 'Không thể đăng nhập.');
    setToken(payload.token);
    setUser(payload.user);
    setSessionReady(true);
  }

  function logout() { setToken(null); setUser(null); setSessionReady(true); }
  return <AuthContext.Provider value={{ user, token, isLoading: Boolean(token) && !sessionReady, login, logout }}>{children}</AuthContext.Provider>;
}

export function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  if (isLoading) return <LoadingPage label="Đang kiểm tra phiên đăng nhập" />;
  if (user) return <Navigate to="/dashboard" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) { setError('Vui lòng nhập tên đăng nhập và mật khẩu.'); return; }
    setError('');
    setIsSubmitting(true);
    try {
      await login(username.trim(), password);
      const destination = (location.state as { from?: string } | null)?.from ?? '/dashboard';
      navigate(destination, { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Đăng nhập không thành công. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className="login-page"><form className="login-card" onSubmit={submit} noValidate><div className="brand">SMART<span>BIN</span><small>OPERATIONS</small></div><div className="eyebrow">TRUY CẬP BẢO MẬT</div><h1>Chào mừng trở lại</h1><p className="login-copy">Đăng nhập bằng tài khoản SmartBin để tiếp tục.</p><label htmlFor="username">Tên đăng nhập<input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="Nhập tên đăng nhập" /></label><label htmlFor="password">Mật khẩu<input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Nhập mật khẩu" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}</button></form></main>;
}

export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: RoleName[] }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <LoadingPage label="Đang tải không gian làm việc" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

function LoadingPage({ label }: { label: string }) {
  return <main className="status-page"><div className="status-panel"><span className="status-dot" /><p>{label}...</p></div></main>;
}

