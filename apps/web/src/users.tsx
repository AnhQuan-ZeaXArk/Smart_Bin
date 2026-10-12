import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth-context';
import { IconRefresh, IconUsers } from './icons';

import { apiUrl } from './api-config';
type AccountRole = 'ADMIN' | 'SUPERVISOR' | 'WORKER';
type AccountUser = {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  isActive: boolean;
};

const roleLabels: Record<AccountRole, string> = {
  ADMIN: 'Quản trị viên',
  SUPERVISOR: 'Giám sát',
  WORKER: 'Nhân viên'
};

export function UsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'ALL' | AccountRole>('ALL');
  const [active, setActive] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${apiUrl}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Không thể tải danh sách tài khoản.');
      const payload = await response.json() as { users: AccountUser[] };
      setUsers(payload.users);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải danh sách tài khoản.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let activeEffect = true;
    queueMicrotask(() => { if (activeEffect) void loadUsers(); });
    return () => { activeEffect = false; };
  }, [loadUsers]);

  const refreshUsers = () => { setLoading(true); setError(''); void loadUsers(); };
  const visibleUsers = useMemo(() => users.filter((user) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch = !query || `${user.username} ${user.displayName}`.toLocaleLowerCase().includes(query);
    const matchesActive = active === 'ALL' || (active === 'ACTIVE' ? user.isActive : !user.isActive);
    return matchesSearch && matchesActive && (role === 'ALL' || user.role === role);
  }), [users, search, role, active]);

  return (
    <section className="page users-page">
      <div className="page-heading">
        <div><div className="eyebrow">ACCESS CONTROL</div><h1>Người dùng</h1><p>Tài khoản và vai trò được cấp quyền truy cập SmartBin.</p></div>
        <div className="user-page-actions"><span className="user-count">{users.length} tài khoản</span><button className="button-secondary" type="button" onClick={refreshUsers} disabled={loading}><IconRefresh /> Làm mới</button></div>
      </div>
      <div className="filter-bar">
        <label className="search-field">Tìm tài khoản<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên đăng nhập hoặc tên hiển thị" /></label>
        <label>Vai trò<select value={role} onChange={(event) => setRole(event.target.value as 'ALL' | AccountRole)}><option value="ALL">Tất cả vai trò</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Trạng thái<select value={active} onChange={(event) => setActive(event.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}><option value="ALL">Tất cả</option><option value="ACTIVE">Đang hoạt động</option><option value="INACTIVE">Đã vô hiệu hóa</option></select></label>
      </div>

      {loading ? <div className="skeleton-table" aria-label="Đang tải tài khoản"><div /><div /><div /><div /></div>
        : error ? <div className="state-panel state-panel--error"><IconUsers /><strong>Không thể tải tài khoản</strong><span>{error}</span><button className="button-secondary" type="button" onClick={refreshUsers}>Thử lại</button></div>
          : visibleUsers.length === 0 ? <div className="state-panel"><IconUsers /><strong>{users.length ? 'Không tìm thấy tài khoản phù hợp' : 'Chưa có tài khoản'}</strong><span>{users.length ? 'Điều chỉnh bộ lọc để xem thêm tài khoản.' : 'Danh sách tài khoản hiện chưa có dữ liệu.'}</span></div>
            : <div className="table-wrap"><table className="users-table"><thead><tr><th>Tài khoản</th><th>Tên hiển thị</th><th>Vai trò</th><th>Trạng thái</th></tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id}><td><strong>{user.username}</strong></td><td>{user.displayName}</td><td><span className={`role-badge role-badge--${user.role.toLowerCase()}`}>{roleLabels[user.role]}</span></td><td><span className={`account-status ${user.isActive ? 'account-status--active' : 'account-status--inactive'}`}>{user.isActive ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</span></td></tr>)}</tbody></table></div>}
      <p className="page-footnote">Thêm tài khoản, đổi mật khẩu và cập nhật quyền trong <Link to="/settings">Cài đặt tài khoản</Link>.</p>
    </section>
  );
}