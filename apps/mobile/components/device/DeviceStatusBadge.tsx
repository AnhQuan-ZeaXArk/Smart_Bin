import React from 'react';
import { DeviceStatus, DEVICE_STATUS_LABELS } from '../../types/device';
import { DEVICE_STATUS_TONE } from '../../constants/theme';
import { Badge } from '../ui/kit';

interface DeviceStatusBadgeProps {
  status: DeviceStatus;
  size?: 'small' | 'medium';
}

/** ONLINE gets a slow soft pulse; WARNING/OFFLINE are static colour only. */
export const DeviceStatusBadge: React.FC<DeviceStatusBadgeProps> = ({ status }) => (
  <Badge
    tone={DEVICE_STATUS_TONE[status] ?? 'critical'}
    label={DEVICE_STATUS_LABELS[status] ?? status}
    dot
    pulse={status === 'ONLINE'}
  />
);
