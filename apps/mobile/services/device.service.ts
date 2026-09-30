import { apiClient } from './api';
import { DeviceItem } from '../types/device';

interface RawDevicesResponse {
  devices: DeviceItem[];
}

interface RawDeviceResponse {
  device: DeviceItem;
}

/**
 * SmartBin Mobile Device Service
 * Interacts directly with existing backend APIs:
 * - GET /api/devices
 * - GET /api/devices/:id
 */
export const deviceService = {
  /**
   * Fetch all registered IoT devices and their current operational status
   */
  async getDevices(): Promise<DeviceItem[]> {
    const response = await apiClient.get<RawDevicesResponse>('/api/devices');
    return response.devices || [];
  },

  /**
   * Fetch a single device status and telemetry by ID or deviceId
   */
  async getDeviceById(id: string): Promise<DeviceItem> {
    const response = await apiClient.get<RawDeviceResponse>(`/api/devices/${encodeURIComponent(id)}`);
    return response.device;
  },
};
