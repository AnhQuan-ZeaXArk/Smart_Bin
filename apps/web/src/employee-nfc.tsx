import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth, type RoleName } from './auth-context';
import { translateCardStatus, translateEmployeeStatus } from './i18n-labels';

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE';
export type CardStatus = 'ACTIVE' | 'REVOKED' | 'LOST' | 'EXPIRED';

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: EmployeeStatus;
  activeCardStatus: CardStatus | null;
  nfcCards?: NfcCard[];
}

export interface NfcCard {
  id: string;
  uid: string;
  status: CardStatus;
  issuedAt: string;
  revokedAt: string | null;
  employee: Employee | null;
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function api<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string }; message?: string } & T;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? payload.message ?? 'Không thể thực hiện yêu cầu.');
  }

  return payload;
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

function roleCanManage(role: RoleName) {
  return role === 'ADMIN' || role === 'SUPERVISOR';
}

function statusClass(value: string) {
  return value.toLowerCase();
}

function EmployeeForm({
  employee,
  onCancel,
  onSaved,
}: {
  employee?: Employee;
  onCancel: () => void;
  onSaved: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [code, setCode] = useState(employee?.employeeCode ?? '');
  const [name, setName] = useState(employee?.fullName ?? '');
  const [phone, setPhone] = useState(employee?.phone ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [status, setStatus] = useState<EmployeeStatus>(employee?.status ?? 'ACTIVE');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();

    try {
      await onSaved(
        employee
          ? { fullName: name, phone: phone || null, email: email || null, status }
          : { employeeCode: code, fullName: name, phone: phone || null, email: email || null, status },
      );
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể lưu thông tin nhân viên.');
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <label>
        Mã nhân viên
        <input value={code} disabled={Boolean(employee)} onChange={(e) => setCode(e.target.value)} required />
      </label>
      <label>
        Họ và tên
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Số điện thoại
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Trạng thái
        <select value={status} onChange={(e) => setStatus(e.target.value as EmployeeStatus)}>
          <option value="ACTIVE">Đang hoạt động</option>
          <option value="INACTIVE">Không hoạt động</option>
        </select>
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="button-secondary" onClick={onCancel}>
          Hủy
        </button>
        <button type="submit">{employee ? 'Lưu thay đổi' : 'Thêm nhân viên'}</button>
      </div>
    </form>
  );
}

export function EmployeeListPage() {
  const { token, user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const canManage = roleCanManage(user!.role);
  const admin = user!.role === 'ADMIN';

  const load = useCallback(async () => {
    try {
      const result = await api<{ employees: Employee[] }>('/api/employees', token!);
      setEmployees(result.employees);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tải danh sách nhân viên');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = employees.filter((employee) =>
    `${employee.employeeCode} ${employee.fullName} ${employee.phone ?? ''} ${employee.email ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  async function save(value: Record<string, unknown>) {
    const current = editing === 'new' ? undefined : editing;
    const result = await api<{ employee: Employee }>(
      current ? `/api/employees/${current.id}` : '/api/employees',
      token!,
      {
        method: current ? 'PUT' : 'POST',
        body: JSON.stringify(value),
      },
    );

    setEmployees((items) =>
      current ? items.map((item) => (item.id === current.id ? result.employee : item)) : [...items, result.employee],
    );
  }

  async function deactivate(employee: Employee) {
    if (!window.confirm(`Vô hiệu hóa ${employee.employeeCode}?`)) return;

    const result = await api<{ employee: Employee }>(`/api/employees/${employee.id}`, token!, {
      method: 'DELETE',
    });

    setEmployees((items) => items.map((item) => (item.id === employee.id ? result.employee : item)));
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DANH SÁCH NHÂN VIÊN</div>
          <h1>Nhân viên</h1>
          <p>Quản lý thông tin nhân viên và thẻ NFC</p>
        </div>
        {canManage && (
          <button type="button" onClick={() => setEditing('new')}>
            + Thêm nhân viên
          </button>
        )}
      </div>

      {error && <div className="empty-state error-state">{error}</div>}

      <label className="wide-search">
        Tìm kiếm
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mã, tên, số điện thoại hoặc email" />
      </label>

      {editing && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <EmployeeForm
              employee={editing === 'new' ? undefined : editing}
              onCancel={() => setEditing(null)}
              onSaved={async (value) => {
                await save(value);
                setEditing(null);
              }}
            />
          </div>
        </div>
      )}

      {loading && employees.length === 0 ? (
        <div className="empty-state">Đang tải danh sách nhân viên...</div>
      ) : (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Mã nhân viên</th>
                <th>Họ và tên</th>
                <th>Số điện thoại</th>
                <th>Email</th>
                <th>Trạng thái</th>
                <th>Thẻ NFC</th>
                {canManage && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.employeeCode}</td>
                  <td>{employee.fullName}</td>
                  <td>{employee.phone || '—'}</td>
                  <td>{employee.email || '—'}</td>
                  <td>
                    <span className={`status-badge status-${statusClass(employee.status)}`}>
                      {translateEmployeeStatus(employee.status)}
                    </span>
                  </td>
                  <td>{employee.activeCardStatus ? translateCardStatus(employee.activeCardStatus) : 'Chưa gán'}</td>
                  {canManage && (
                    <td>
                      <button type="button" onClick={() => setEditing(employee)}>
                        Sửa
                      </button>
                      <button type="button" onClick={() => void deactivate(employee)}>
                        Vô hiệu hóa
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length === 0 && <p className="muted">Không có nhân viên nào phù hợp.</p>}

      {admin && <div className="admin-note">Quản lý thông tin nhân viên và thẻ NFC</div>}
    </section>
  );
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<{ employee: Employee }>(`/api/employees/${id}`, token!);
      setEmployee(result.employee);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tải thông tin nhân viên.');
    }
  }, [id, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (error) {
    return (
      <section className="page">
        <div className="empty-state error-state">{error}</div>
      </section>
    );
  }

  if (!employee) {
    return (
      <section className="page">
        <div className="empty-state">Đang tải thông tin nhân viên...</div>
      </section>
    );
  }

  return (
    <section className="page detail-page">
      <Link className="back-link" to="/employees">
        ← Quay lại danh sách nhân viên
      </Link>

      <div className="detail-heading">
        <div>
          <div className="eyebrow">CHI TIẾT NHÂN VIÊN</div>
          <h1>{employee.employeeCode}</h1>
          <p>{employee.fullName}</p>
        </div>
        <span className={`status-badge status-${statusClass(employee.status)}`}>
          {translateEmployeeStatus(employee.status)}
        </span>
      </div>

      <div className="detail-grid">
        <div className="detail-card">
          <h2>Thông tin nhân viên</h2>
          <dl>
            <dt>Họ và tên</dt>
            <dd>{employee.fullName}</dd>
            <dt>Số điện thoại</dt>
            <dd>{employee.phone || '—'}</dd>
            <dt>Email</dt>
            <dd>{employee.email || '—'}</dd>
            <dt>Trạng thái</dt>
            <dd>{translateEmployeeStatus(employee.status)}</dd>
          </dl>
        </div>

        <div className="detail-card">
          <h2>Thông tin thẻ NFC</h2>
          {employee.nfcCards?.length ? (
            employee.nfcCards.map((card) => (
              <div className="card-summary" key={card.id}>
                <strong>{card.uid}</strong>
                <span className={`badge badge-${statusClass(card.status)}`}>{translateCardStatus(card.status)}</span>
                <span>Cấp ngày: {date(card.issuedAt)}</span>
                <span>Thu hồi: {date(card.revokedAt)}</span>
              </div>
            ))
          ) : (
            <p className="empty-copy">Chưa gán thẻ NFC.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function NfcCardListPage() {
  const { token, user } = useAuth();
  const [cards, setCards] = useState<NfcCard[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | CardStatus>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canManage = user!.role === 'ADMIN' || user!.role === 'SUPERVISOR';
  const admin = user!.role === 'ADMIN';

  const load = useCallback(async () => {
    try {
      const [cardResult] = await Promise.all([
        api<{ cards: NfcCard[] }>('/api/nfc-cards', token!),
      ]);
      setCards(cardResult.cards);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tải danh sách thẻ NFC');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = cards.filter(
    (card) =>
      (status === 'ALL' || card.status === status) &&
      `${card.uid} ${card.employee?.fullName ?? ''} ${card.employee?.employeeCode ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  async function changeStatus(card: NfcCard, next: CardStatus) {
    const result = await api<{ card: NfcCard }>(`/api/nfc-cards/${card.id}`, token!, {
      method: 'PUT',
      body: JSON.stringify({ status: next }),
    });

    setCards((items) => items.map((item) => (item.id === card.id ? result.card : item)));
  }

  async function assign(card: NfcCard) {
    const employeeId = window.prompt(`Nhập mã nhân viên (Employee ID) cho thẻ ${card.uid}`);
    if (!employeeId) return;

    const result = await api<{ card: NfcCard }>(`/api/nfc-cards/${card.id}/assign`, token!, {
      method: 'POST',
      body: JSON.stringify({ employeeId }),
    });

    setCards((items) => items.map((item) => (item.id === card.id ? result.card : item)));
  }

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DANH SÁCH THẺ NFC</div>
          <h1>Thẻ NFC</h1>
          <p>Quản lý và kiểm soát định danh xác thực thiết bị.</p>
        </div>
        {admin && (
          <button
            type="button"
            onClick={() => {
              const uid = window.prompt('Nhập UID thẻ NFC');
              const employeeId = window.prompt('Nhập mã nhân viên (Employee ID)');
              if (uid && employeeId) {
                void api<{ card: NfcCard }>('/api/nfc-cards', token!, {
                  method: 'POST',
                  body: JSON.stringify({ uid, employeeId }),
                })
                  .then((result) => setCards((items) => [result.card, ...items]))
                  .catch((e) => setError(e instanceof Error ? e.message : 'Không thể tạo thẻ.'));
              }
            }}
          >
            + Thêm thẻ
          </button>
        )}
      </div>

      {error && <div className="empty-state error-state">{error}</div>}

      <div className="filter-bar">
        <label className="search-field">
          Tìm kiếm
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="UID, tên nhân viên hoặc mã nhân viên" />
        </label>
        <label>
          Trạng thái
          <select value={status} onChange={(e) => setStatus(e.target.value as 'ALL' | CardStatus)}>
            <option value="ALL">Tất cả trạng thái</option>
            <option value="ACTIVE">Đang hoạt động</option>
            <option value="REVOKED">Đã thu hồi</option>
            <option value="LOST">Đã mất</option>
            <option value="EXPIRED">Đã hết hạn</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="empty-state">Đang tải danh sách thẻ NFC...</div>
      ) : (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>UID</th>
                <th>Nhân viên</th>
                <th>Trạng thái</th>
                <th>Ngày cấp</th>
                <th>Thu hồi</th>
                {canManage && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((card) => (
                <tr key={card.id}>
                  <td>{card.uid}</td>
                  <td>{card.employee ? `${card.employee.fullName} (${card.employee.employeeCode})` : 'Chưa gán'}</td>
                  <td>
                    <span className={`badge badge-${statusClass(card.status)}`}>{translateCardStatus(card.status)}</span>
                  </td>
                  <td>{date(card.issuedAt)}</td>
                  <td>{date(card.revokedAt)}</td>
                  {canManage && (
                    <td>
                      <select value={card.status} onChange={(e) => void changeStatus(card, e.target.value as CardStatus)}>
                        <option value="ACTIVE">Đang hoạt động</option>
                        <option value="REVOKED">Đã thu hồi</option>
                        <option value="LOST">Đã mất</option>
                        <option value="EXPIRED">Đã hết hạn</option>
                      </select>
                      <button type="button" onClick={() => void assign(card)}>
                        Gán nhân viên
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length === 0 && <p className="muted">Không có thẻ NFC nào phù hợp với bộ lọc hiện tại.</p>}
    </section>
  );
}
