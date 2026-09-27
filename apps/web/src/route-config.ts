import type { RoleName } from './auth-context';

export type AppRoute = { path: string; label: string; roles: RoleName[] };

export const appRoutes: AppRoute[] = [
  { path: '/dashboard', label: 'Dashboard', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] },
  { path: '/bins', label: 'Bins', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] },
  { path: '/devices', label: 'Thiết bị', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] },
  { path: '/sensor-history', label: 'Sensor History', roles: ['ADMIN', 'SUPERVISOR'] },
  { path: '/collections', label: 'Collection History', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] },
  { path: '/alerts', label: 'Alerts', roles: ['ADMIN', 'SUPERVISOR'] },
  { path: '/users', label: 'Users', roles: ['ADMIN'] },
  { path: '/settings', label: 'Settings', roles: ['ADMIN', 'SUPERVISOR', 'WORKER'] }
];
