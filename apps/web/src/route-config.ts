import type { RoleName } from './auth-context';

export type AppRoute = { path: string; label: string; roles: RoleName[]; showInNav?: boolean };

export const appRoutes: AppRoute[] = [
  { path: '/dashboard', label: 'Tổng quan', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'], showInNav: true },
  { path: '/bins', label: 'Thùng rác', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'], showInNav: true },
  { path: '/alerts', label: 'Cảnh báo', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'], showInNav: true },
  { path: '/settings', label: 'Cài đặt', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'], showInNav: true },
  { path: '/devices', label: 'Thiết bị', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'], showInNav: false },
  { path: '/sensor-history', label: 'Lịch sử cảm biến', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'], showInNav: false },
  { path: '/collections', label: 'Lịch sử thu gom', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'], showInNav: false },
  { path: '/users', label: 'Người dùng', roles: ['ADMIN'], showInNav: false }
];
