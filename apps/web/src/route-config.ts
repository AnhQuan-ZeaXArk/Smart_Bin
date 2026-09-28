import type { RoleName } from './auth-context';

export type AppRoute = { path: string; label: string; roles: RoleName[] };

export const appRoutes: AppRoute[] = [
  { path: '/dashboard', label: 'Tổng quan', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] },
  { path: '/bins', label: 'Thùng rác', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] },
  { path: '/devices', label: 'Thiết bị', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] },
  { path: '/sensor-history', label: 'Lịch sử cảm biến', roles: ['ADMIN', 'SUPERVISOR'] },
  { path: '/collections', label: 'Lịch sử thu gom', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] },
  { path: '/alerts', label: 'Cảnh báo', roles: ['ADMIN', 'SUPERVISOR'] },
  { path: '/users', label: 'Người dùng', roles: ['ADMIN'] },
  { path: '/settings', label: 'Cài đặt', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] }
];
