import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext, useAuth, type RoleName, type SessionUser, type SystemMode } from './auth-context';
import { apiUrl } from './api-config';
import { IconAlertTriangle, IconEye, IconEyeOff, IconLock, IconRefresh, IconShield } from './icons';

const TOKEN_STORAGE_KEY = 'smartbin_auth_token';

interface HealthResponse {
  status: string;
  service: string;
  mode: 'demo' | 'production';
}

interface LoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    displayName?: string;
    role: RoleName;
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [systemMode, setSystemMode] = useState<SystemMode>('unknown');
  const [healthCheckNonce, setHealthCheckNonce] = useState(0);

  // Kiểm tra phiên làm việc hiện tại với Backend
  const verifySession = useCallback(async (authToken: string): Promise<SessionUser | null> => {
    try {
      const response = await fetch(`${apiUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      if (response.ok) {
        const data = (await response.json()) as SessionUser;
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  // Khởi tạo phiên khi nạp ứng dụng hoặc khi retry kết nối
  useEffect(() => {
    let active = true;

    async function initAuth() {
      setIsLoading(true);
      let detectedMode: SystemMode = 'unknown';

      // 1. Nhận biết chế độ Demo / Production từ API /health với cơ chế timeout 5 giây
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const healthRes = await fetch(`${apiUrl}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (healthRes.ok) {
          const healthData = (await healthRes.json()) as HealthResponse;
          if (healthData && (healthData.mode === 'production' || healthData.mode === 'demo')) {
            detectedMode = healthData.mode;
          } else {
            detectedMode = 'unknown'; // Dữ liệu không hợp lệ -> Unknown
          }
        } else {
          detectedMode = 'unknown'; // HTTP lỗi -> Unknown
        }
      } catch {
        detectedMode = 'unknown'; // Timeout hoặc network error -> Unknown
      }

      if (!active) return;
      setSystemMode(detectedMode);

      // Trường hợp C - Unknown: Tuyệt đối không fallback sang Demo, không khởi tạo Demo Operator
      if (detectedMode === 'unknown') {
        setUser(null);
        setToken(null);
        setIsLoading(false);
        return;
      }

      const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);

      // 2. Nếu có token đã lưu, kiểm tra tính hợp lệ qua Backend
      if (savedToken) {
        const validUser = await verifySession(savedToken);
        if (!active) return;

        if (validUser) {
          setUser(validUser);
          setToken(savedToken);
          setIsLoading(false);
          return;
        }

        // Token không hợp lệ hoặc đã hết hạn -> Dọn dẹp an toàn
        try {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
        } catch {
          // ignore
        }
        setToken(null);
        setUser(null);
      }

      // Trường hợp A - Demo Mode
      if (detectedMode === 'demo') {
        setUser({
          id: 'demo-operator',
          username: 'demo',
          displayName: 'Người vận hành Demo',
          role: 'ADMIN'
        });
        setToken('demo-mode-token');
      } else {
        // Trường hợp B - Production Mode: Bắt buộc đăng nhập tài khoản thực
        setUser(null);
        setToken(null);
      }

      setIsLoading(false);
    }

    void initAuth();

    return () => {
      active = false;
    };
  }, [verifySession, healthCheckNonce]);

  const retryHealthCheck = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setHealthCheckNonce((k) => k + 1);
  }, []);

  const login = async (username: string, password: string): Promise<void> => {
    const res = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      let message = 'Tên đăng nhập hoặc mật khẩu không chính xác.';
      try {
        const data = await res.json();
        if (data.message) message = data.message;
      } catch {
        // fallback
      }
      throw new Error(message);
    }

    const payload = (await res.json()) as LoginResponse;
    const receivedToken = payload.token;
    const sessionUser: SessionUser = {
      id: payload.user.id,
      username: payload.user.username,
      displayName: payload.user.displayName ?? payload.user.username,
      role: payload.user.role
    };

    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, receivedToken);
    } catch {
      // storage unavailable
    }

    setToken(receivedToken);
    setUser(sessionUser);
  };

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // ignore
    }
    setToken(null);
    setUser(null);

    // Nếu ở Demo Mode, reset lại session demo sau khi logout
    if (systemMode === 'demo') {
      setUser({
        id: 'demo-operator',
        username: 'demo',
        displayName: 'Người vận hành Demo',
        role: 'ADMIN'
      });
      setToken('demo-mode-token');
    }
  }, [systemMode]);

  const refreshProfile = async (): Promise<void> => {
    if (!token) return;
    const updated = await verifySession(token);
    if (updated) {
      setUser(updated);
    } else {
      logout();
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, systemMode, login, logout, refreshProfile, retryHealthCheck }}>
      {children}
    </AuthContext.Provider>
  );
}

export function LoginPage() {
  const { user, token, systemMode, login, isLoading: authLoading, retryHealthCheck } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Nơi cần chuyển đến sau khi đăng nhập thành công
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname || '/dashboard';

  // Nếu đã đăng nhập hợp lệ trong Production, chuyển ngay tới dashboard
  useEffect(() => {
    if (!authLoading && user && token && systemMode === 'production') {
      navigate(from, { replace: true });
    }
  }, [authLoading, user, token, systemMode, from, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanUser = username.trim();
    if (!cleanUser) {
      setErrorMessage('Vui lòng nhập tên tài khoản.');
      return;
    }
    if (!password) {
      setErrorMessage('Vui lòng nhập mật khẩu.');
      return;
    }

    setSubmitting(true);
    try {
      await login(cleanUser, password);
      navigate(from, { replace: true });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Đăng nhập không thành công.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoQuickAccess = async () => {
    setSubmitting(true);
    setErrorMessage('');
    try {
      await login('demo', 'demo123');
      navigate(from, { replace: true });
    } catch {
      // Fallback cho Demo Mode
      navigate('/dashboard', { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-container">
        <div className="login-branding">
          <span className="brand-mark">S</span>
          <span>
            <strong>SMART<span>BIN</span></strong>
            <small>HỆ THỐNG QUẢN LÝ THÙNG RÁC THÔNG MINH</small>
          </span>
        </div>

        <div className="login-card">
          <h1>Đăng nhập hệ thống</h1>
          <p className="login-copy" style={{ textAlign: 'center', marginBottom: '8px' }}>
            {systemMode === 'demo' ? (
              <span className="badge badge-normal" style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span className="status-dot" style={{ background: '#28d5a0' }} />
                Đang chạy chế độ mô phỏng (Demo Mode)
              </span>
            ) : systemMode === 'production' ? (
              <span className="badge badge-device-status badge-device-online" style={{ fontSize: '11px' }}>
                <IconShield /> Chế độ vận hành thực tế (Production)
              </span>
            ) : (
              <span className="badge badge-device-status badge-device-warning" style={{ fontSize: '11px', color: '#fca5a5', borderColor: '#ef4444' }}>
                <IconAlertTriangle /> Không thể xác định chế độ máy chủ
              </span>
            )}
          </p>

          {systemMode === 'unknown' && (
            <div className="form-error" style={{ marginBottom: '12px' }}>
              <IconAlertTriangle />
              <div style={{ display: 'grid', gap: '4px' }}>
                <span>Chưa kết nối được máy chủ Backend.</span>
                <button
                  type="button"
                  onClick={() => void retryHealthCheck()}
                  className="button-secondary"
                  style={{ fontSize: '11px', padding: '4px 8px', marginTop: '4px', alignSelf: 'flex-start' }}
                >
                  <IconRefresh /> Thử kết nối lại
                </button>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="form-error" role="alert">
              <IconAlertTriangle />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
            <label>
              TÊN ĐĂNG NHẬP
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Nhập tên tài khoản"
                autoComplete="username"
                disabled={submitting || systemMode === 'unknown'}
                className={errorMessage ? 'input-error' : ''}
                autoFocus
              />
            </label>

            <label>
              MẬT KHẨU
              <div className="password-input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu"
                  autoComplete="current-password"
                  disabled={submitting || systemMode === 'unknown'}
                  className={errorMessage ? 'input-error' : ''}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  tabIndex={-1}
                  disabled={submitting || systemMode === 'unknown'}
                >
                  {showPassword ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </label>

            <button type="submit" disabled={submitting || systemMode === 'unknown'}>
              {submitting ? (
                <>
                  <span className="login-spinner" />
                  <span>Đang xác thực...</span>
                </>
              ) : (
                <>
                  <IconLock />
                  <span>Đăng nhập</span>
                </>
              )}
            </button>
          </form>

          {systemMode === 'demo' && (
            <div style={{ marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
              <button
                type="button"
                className="button-secondary"
                onClick={handleDemoQuickAccess}
                disabled={submitting}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Vào nhanh Chế độ Demo →
              </button>
            </div>
          )}

          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <Link
              to="/dashboard"
              style={{
                fontSize: '12px',
                color: '#28d5a0',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              ← Về trang tổng quan công khai
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export function ProtectedRoute({
  children,
  roles
}: {
  children: ReactNode;
  roles?: RoleName[];
}) {
  const { user, token, isLoading, systemMode, retryHealthCheck } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', color: '#718078' }}>
          <span className="login-spinner" style={{ width: '28px', height: '28px', borderWidth: '3px' }} />
          <span>Đang kiểm tra quyền truy cập...</span>
        </div>
      </div>
    );
  }

  // Trường hợp C - Unknown: Tuyệt đối không cho phép vào Dashboard, hiển thị màn hình lỗi kết nối
  if (systemMode === 'unknown') {
    return (
      <main className="status-page" style={{ minHeight: '80vh', display: 'grid', placeItems: 'center', padding: '24px' }}>
        <div className="error-panel" style={{ maxWidth: '520px', width: '100%', textAlign: 'center' }}>
          <div className="eyebrow" style={{ color: '#ef4444' }}>LỖI KẾT NỐI MÁY CHỦ</div>
          <div className="error-code" style={{ fontSize: '32px', color: '#ef4444' }}>OFFLINE</div>
          <h1 style={{ fontSize: '20px', margin: '8px 0' }}>Không thể kết nối đến máy chủ SmartBin</h1>
          <p style={{ color: '#718078', lineHeight: 1.5, marginBottom: '20px', fontSize: '13px' }}>
            Hệ thống không thể xác định chế độ vận hành hoặc máy chủ Backend đang khởi động lại.
            Để bảo vệ an toàn dữ liệu, quyền truy cập tạm thời bị khóa cho đến khi kết nối được phục hồi.
          </p>
          <button
            type="button"
            onClick={() => void retryHealthCheck()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              cursor: 'pointer',
              fontWeight: 700
            }}
          >
            <IconRefresh /> Thử kết nối lại
          </button>
        </div>
      </main>
    );
  }

  // Trường hợp A - Demo Mode: Cho phép xem dữ liệu mô phỏng mà không bị chặn
  if (systemMode === 'demo') {
    return <>{children}</>;
  }

  // Trường hợp B - Production Mode:
  // Nếu route KHÔNG yêu cầu role hạn chế -> Cho phép truy cập công khai không cần đăng nhập
  if (!roles || roles.length === 0) {
    return <>{children}</>;
  }

  // Đối với các route yêu cầu vai trò quản trị (ví dụ: ADMIN cho /users):
  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Kiểm tra phân quyền RBAC
  if (!roles.includes(user.role)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}
