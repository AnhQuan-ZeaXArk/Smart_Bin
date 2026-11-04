export interface DemoBin {
  id: string;
  binCode: string;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  capacity: number;
  currentFillLevel: number;
  distanceCm: number | null;
  fillCategory: 'NORMAL' | 'MONITOR' | 'NEARLY_FULL' | 'CRITICAL';
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
  isActive: boolean;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
}

export interface DemoDevice {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceType: 'RASPBERRY_PI' | 'ULTRASONIC_SENSOR' | 'CAMERA' | 'MQTT';
  status: 'ONLINE' | 'WARNING' | 'OFFLINE';
  lastSeen: string;
  lastHeartbeat: string | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
  uptime: number | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoAlert {
  id: string;
  binId: string | null;
  type: 'NEARLY_FULL' | 'CRITICAL' | 'DEVICE_OFFLINE' | 'SENSOR_ABNORMAL';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  isResolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
  bin?: { binCode: string; name: string } | null;
}

export interface DemoSensorReading {
  id: string;
  binId: string;
  distance: number;
  fillLevel: number;
  timestamp: string;
  createdAt: string;
  bin: { binCode: string; name: string };
}

export interface DemoCollectionRecord {
  id: string;
  binId: string;
  collectedBy: string | null;
  collectedAt: string;
  fillLevelBefore: number;
  fillLevelAfter: number | null;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING' | 'CANCELLED';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  bin: { binCode: string; name: string };
}

const now = new Date();
const timeAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000).toISOString();
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

export const DEMO_BINS: DemoBin[] = [
  {
    id: 'bin-organic-01',
    binCode: 'ORGANIC',
    name: 'Rác hữu cơ',
    location: 'Ngăn rác hữu cơ - Khu vực demo',
    latitude: 10.7769,
    longitude: 106.7009,
    capacity: 240,
    currentFillLevel: 25,
    distanceCm: 75,
    fillCategory: 'NORMAL',
    status: 'ONLINE',
    isActive: true,
    lastSeen: timeAgo(2),
    createdAt: hoursAgo(72),
    updatedAt: timeAgo(2)
  },
  {
    id: 'bin-recyclable-02',
    binCode: 'RECYCLABLE',
    name: 'Rác tái chế',
    location: 'Ngăn rác tái chế - Khu vực demo',
    latitude: 10.7769,
    longitude: 106.7009,
    capacity: 240,
    currentFillLevel: 58,
    distanceCm: 42,
    fillCategory: 'MONITOR',
    status: 'ONLINE',
    isActive: true,
    lastSeen: timeAgo(1),
    createdAt: hoursAgo(72),
    updatedAt: timeAgo(1)
  },
  {
    id: 'bin-non-recyclable-03',
    binCode: 'NON_RECYCLABLE',
    name: 'Rác không tái chế',
    location: 'Ngăn rác không tái chế - Khu vực demo',
    latitude: 10.7769,
    longitude: 106.7009,
    capacity: 360,
    currentFillLevel: 78,
    distanceCm: 22,
    fillCategory: 'NEARLY_FULL',
    status: 'ONLINE',
    isActive: true,
    lastSeen: timeAgo(1),
    createdAt: hoursAgo(72),
    updatedAt: timeAgo(1)
  }
];

export const DEMO_DEVICES: DemoDevice[] = [
  {
    id: 'dev-rpi-01',
    deviceId: 'raspberry-pi-5',
    deviceName: 'Raspberry Pi 5 Gateway',
    deviceType: 'RASPBERRY_PI',
    status: 'ONLINE',
    lastSeen: timeAgo(1),
    lastHeartbeat: timeAgo(1),
    firmwareVersion: 'v1.0.0-demo',
    ipAddress: '192.168.1.105',
    uptime: 86400,
    metadata: JSON.stringify({ mode: 'DEMO_SIMULATION', cpuTempC: 43.2, memoryUsagePct: 32 }),
    createdAt: hoursAgo(72),
    updatedAt: timeAgo(1)
  },
  {
    id: 'dev-ultra-01',
    deviceId: 'ultrasonic-01',
    deviceName: 'Cảm biến siêu âm',
    deviceType: 'ULTRASONIC_SENSOR',
    status: 'ONLINE',
    lastSeen: timeAgo(1),
    lastHeartbeat: timeAgo(1),
    firmwareVersion: 'v2.1.0',
    ipAddress: null,
    uptime: 86400,
    metadata: JSON.stringify({ distanceCm: 22, fillLevel: 78, mode: 'DEMO_SIMULATION' }),
    createdAt: hoursAgo(72),
    updatedAt: timeAgo(1)
  },
  {
    id: 'dev-cam-01',
    deviceId: 'camera-01',
    deviceName: 'Camera AI',
    deviceType: 'CAMERA',
    status: 'ONLINE',
    lastSeen: timeAgo(2),
    lastHeartbeat: timeAgo(2),
    firmwareVersion: 'v1.4.0',
    ipAddress: '192.168.1.106',
    uptime: 43200,
    metadata: JSON.stringify({ aiModel: 'YOLOv8-Waste-Demo', confidence: 0.94, mode: 'DEMO_SIMULATION' }),
    createdAt: hoursAgo(72),
    updatedAt: timeAgo(2)
  },
  {
    id: 'dev-mqtt-01',
    deviceId: 'mqtt-broker-01',
    deviceName: 'Kết nối MQTT Broker',
    deviceType: 'MQTT',
    status: 'ONLINE',
    lastSeen: timeAgo(1),
    lastHeartbeat: timeAgo(1),
    firmwareVersion: 'v5.15.2',
    ipAddress: null,
    uptime: 86400,
    metadata: JSON.stringify({ broker: 'Simulated Broker (Demo Mode)', mode: 'DEMO_SIMULATION' }),
    createdAt: hoursAgo(72),
    updatedAt: timeAgo(1)
  }
];

export const DEMO_ALERTS: DemoAlert[] = [
  {
    id: 'alert-demo-01',
    binId: 'bin-non-recyclable-03',
    type: 'CRITICAL',
    severity: 'CRITICAL',
    message: 'Ngăn rác không tái chế đạt 78% — cần lên lịch thu gom sớm.',
    isResolved: false,
    createdAt: timeAgo(15),
    resolvedAt: null,
    bin: { binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế' }
  },
  {
    id: 'alert-demo-02',
    binId: 'bin-recyclable-02',
    type: 'NEARLY_FULL',
    severity: 'WARNING',
    message: 'Ngăn rác tái chế vượt ngưỡng theo dõi (58%).',
    isResolved: false,
    createdAt: timeAgo(45),
    resolvedAt: null,
    bin: { binCode: 'RECYCLABLE', name: 'Rác tái chế' }
  },
  {
    id: 'alert-demo-03',
    binId: null,
    type: 'SENSOR_ABNORMAL',
    severity: 'INFO',
    message: 'Hệ thống SmartBin đang hoạt động ở chế độ Demo mô phỏng độc lập.',
    isResolved: false,
    createdAt: hoursAgo(2),
    resolvedAt: null,
    bin: null
  }
];

export const DEMO_SENSOR_READINGS: DemoSensorReading[] = [
  {
    id: 'read-demo-01',
    binId: 'bin-non-recyclable-03',
    distance: 22,
    fillLevel: 78,
    timestamp: timeAgo(5),
    createdAt: timeAgo(5),
    bin: { binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế' }
  },
  {
    id: 'read-demo-02',
    binId: 'bin-recyclable-02',
    distance: 42,
    fillLevel: 58,
    timestamp: timeAgo(10),
    createdAt: timeAgo(10),
    bin: { binCode: 'RECYCLABLE', name: 'Rác tái chế' }
  },
  {
    id: 'read-demo-03',
    binId: 'bin-organic-01',
    distance: 75,
    fillLevel: 25,
    timestamp: timeAgo(15),
    createdAt: timeAgo(15),
    bin: { binCode: 'ORGANIC', name: 'Rác hữu cơ' }
  },
  {
    id: 'read-demo-04',
    binId: 'bin-non-recyclable-03',
    distance: 24,
    fillLevel: 76,
    timestamp: timeAgo(30),
    createdAt: timeAgo(30),
    bin: { binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế' }
  },
  {
    id: 'read-demo-05',
    binId: 'bin-recyclable-02',
    distance: 46,
    fillLevel: 54,
    timestamp: timeAgo(45),
    createdAt: timeAgo(45),
    bin: { binCode: 'RECYCLABLE', name: 'Rác tái chế' }
  },
  {
    id: 'read-demo-06',
    binId: 'bin-organic-01',
    distance: 77,
    fillLevel: 23,
    timestamp: timeAgo(60),
    createdAt: timeAgo(60),
    bin: { binCode: 'ORGANIC', name: 'Rác hữu cơ' }
  },
  {
    id: 'read-demo-07',
    binId: 'bin-non-recyclable-03',
    distance: 27,
    fillLevel: 73,
    timestamp: hoursAgo(2),
    createdAt: hoursAgo(2),
    bin: { binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế' }
  },
  {
    id: 'read-demo-08',
    binId: 'bin-recyclable-02',
    distance: 51,
    fillLevel: 49,
    timestamp: hoursAgo(3),
    createdAt: hoursAgo(3),
    bin: { binCode: 'RECYCLABLE', name: 'Rác tái chế' }
  }
];

export const DEMO_COLLECTIONS: DemoCollectionRecord[] = [
  {
    id: 'col-demo-01',
    binId: 'bin-non-recyclable-03',
    collectedBy: 'Lê Văn Bình',
    collectedAt: hoursAgo(3),
    fillLevelBefore: 85,
    fillLevelAfter: 15,
    status: 'COMPLETED',
    notes: 'Đã hoàn tất thu gom ngăn rác không tái chế định kỳ buổi sáng.',
    createdAt: hoursAgo(4),
    updatedAt: hoursAgo(3),
    bin: { binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế' }
  },
  {
    id: 'col-demo-02',
    binId: 'bin-recyclable-02',
    collectedBy: 'Trần Thu Hà',
    collectedAt: hoursAgo(1),
    fillLevelBefore: 60,
    fillLevelAfter: null,
    status: 'IN_PROGRESS',
    notes: 'Đang tiếp cận thu gom và phân loại rác tái chế.',
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
    bin: { binCode: 'RECYCLABLE', name: 'Rác tái chế' }
  },
  {
    id: 'col-demo-03',
    binId: 'bin-organic-01',
    collectedBy: 'Nguyễn Minh An',
    collectedAt: timeAgo(30),
    fillLevelBefore: 30,
    fillLevelAfter: null,
    status: 'PENDING',
    notes: 'Đã lên lịch thu gom rác hữu cơ theo ca chiều.',
    createdAt: timeAgo(30),
    updatedAt: timeAgo(30),
    bin: { binCode: 'ORGANIC', name: 'Rác hữu cơ' }
  },
  {
    id: 'col-demo-04',
    binId: 'bin-organic-01',
    collectedBy: 'Lê Văn Bình',
    collectedAt: hoursAgo(24),
    fillLevelBefore: 20,
    fillLevelAfter: null,
    status: 'CANCELLED',
    notes: 'Hủy lịch thu gom do mức đầy chưa đạt ngưỡng yêu cầu.',
    createdAt: hoursAgo(25),
    updatedAt: hoursAgo(24),
    bin: { binCode: 'ORGANIC', name: 'Rác hữu cơ' }
  }
];
