import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from './auth-context';
import { FILL_LEVEL_STATUS_LABEL, FILL_LEVEL_STATUS_TONE, getFillLevelStatus, readSmartBinThresholds } from './threshold-config';

export type BinStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
export type FillCategory = 'NORMAL' | 'MONITOR' | 'NEARLY_FULL' | 'CRITICAL';
export type WasteCompartmentKey = 'ORGANIC' | 'RECYCLABLE' | 'NON_RECYCLABLE';
export type CompartmentStatus = 'BÌNH THƯỜNG' | 'CẦN THEO DÕI' | 'GẦN ĐẦY' | 'ĐẦY';
export type DeviceState = 'ONLINE' | 'OFFLINE';

export interface Bin {
  id: string;
  binCode: string;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  capacity: number;
  currentFillLevel: number;
  fillCategory: FillCategory;
  status: BinStatus;
  isActive: boolean;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompartmentCard {
  key: WasteCompartmentKey;
  label: string;
  fillLevel: number;
  status: CompartmentStatus;
  deviceState: DeviceState;
  updatedAt: string;
}

const demoCompartments: CompartmentCard[] = [
  { key: 'ORGANIC', label: 'Rác hữu cơ', fillLevel: 25, status: 'BÌNH THƯỜNG', deviceState: 'ONLINE', updatedAt: 'Vừa cập nhật' },
  { key: 'RECYCLABLE', label: 'Rác tái chế', fillLevel: 58, status: 'CẦN THEO DÕI', deviceState: 'ONLINE', updatedAt: '2 phút trước' },
  { key: 'NON_RECYCLABLE', label: 'Rác không tái chế', fillLevel: 78, status: 'GẦN ĐẦY', deviceState: 'ONLINE', updatedAt: '5 phút trước' }
];

function getFillTone(level: number) {
  const thresholds = readSmartBinThresholds();
  return FILL_LEVEL_STATUS_TONE[getFillLevelStatus(level, thresholds)];
}

function getStatusTone(status: CompartmentStatus) {
  if (status === 'BÌNH THƯỜNG') return 'normal';
  if (status === 'CẦN THEO DÕI') return 'monitor';
  if (status === 'GẦN ĐẦY') return 'nearly_full';
  return 'critical';
}

export function BinListPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState<'ALL' | WasteCompartmentKey>('ALL');
  const [fill, setFill] = useState<'ALL' | 'normal' | 'monitor' | 'nearly_full' | 'critical'>('ALL');
  const [deviceState, setDeviceState] = useState<'ALL' | DeviceState>('ALL');

  const thresholds = readSmartBinThresholds();
  const filteredCompartments = demoCompartments.map((compartment) => {
    const status = getFillLevelStatus(compartment.fillLevel, thresholds);
    const mappedStatus: CompartmentStatus = status === 'NORMAL' ? 'BÌNH THƯỜNG' : status === 'WARNING' ? 'CẦN THEO DÕI' : status === 'NEARLY_FULL' ? 'GẦN ĐẦY' : 'ĐẦY';
    return { ...compartment, status: mappedStatus };
  }).filter((compartment) => {
    const matchesCategory = category === 'ALL' || compartment.key === category;
    const matchesFill = fill === 'ALL' || getFillTone(compartment.fillLevel) === fill;
    const matchesDevice = deviceState === 'ALL' || compartment.deviceState === deviceState;
    return matchesCategory && matchesFill && matchesDevice;
  });

  return (
    <section className="page bins-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">QUẢN LÝ HỆ THỐNG SMARTBIN</div>
          <h1>Thùng rác</h1>
          <p>Hệ thống SmartBin duy nhất gồm ba ngăn chứa rác với dữ liệu cảm biến theo thời gian thực.</p>
        </div>
        {user && user.role !== 'WORKER' && <button type="button" className="button-primary">Cập nhật hệ thống</button>}
      </div>

      <div className="filter-bar">
        <label>
          Loại rác
          <select value={category} onChange={(event) => setCategory(event.target.value as 'ALL' | WasteCompartmentKey)}>
            <option value="ALL">Tất cả</option>
            <option value="ORGANIC">Rác hữu cơ</option>
            <option value="RECYCLABLE">Rác tái chế</option>
            <option value="NON_RECYCLABLE">Rác không tái chế</option>
          </select>
        </label>
        <label>
          Mức độ đầy
          <select value={fill} onChange={(event) => setFill(event.target.value as 'ALL' | 'normal' | 'monitor' | 'nearly_full' | 'critical')}>
            <option value="ALL">Tất cả</option>
            <option value="normal">Bình thường</option>
            <option value="monitor">Cần theo dõi</option>
            <option value="nearly_full">Gần đầy</option>
            <option value="critical">Đầy</option>
          </select>
        </label>
        <label>
          Trạng thái thiết bị
          <select value={deviceState} onChange={(event) => setDeviceState(event.target.value as 'ALL' | DeviceState)}>
            <option value="ALL">Tất cả</option>
            <option value="ONLINE">Trực tuyến</option>
            <option value="OFFLINE">Ngoại tuyến</option>
          </select>
        </label>
      </div>

      {filteredCompartments.length === 0 ? (
        <div className="empty-state">Không tìm thấy ngăn rác nào phù hợp với bộ lọc hiện tại.</div>
      ) : (
        <div className="waste-grid">
          {filteredCompartments.map((compartment) => {
            const statusTone = getStatusTone(compartment.status);
            const fillStatus = getFillLevelStatus(compartment.fillLevel, thresholds);
            return (
              <article key={compartment.key} className={`waste-card waste-tone-${statusTone}`}>
                <div className="waste-card-header">
                  <h3>{compartment.label}</h3>
                  <span className={`status-badge status-${compartment.deviceState.toLowerCase()}`}>
                    {compartment.deviceState === 'ONLINE' ? 'Trực tuyến' : 'Ngoại tuyến'}
                  </span>
                </div>
                <strong className="waste-percentage">{compartment.fillLevel}%</strong>
                <div className="waste-progress-track" role="progressbar" aria-valuenow={compartment.fillLevel} aria-valuemin={0} aria-valuemax={100}>
                  <span className={`waste-progress-fill waste-tone-${statusTone}`} style={{ width: `${compartment.fillLevel}%` }} />
                </div>
                <div className="waste-card-footer">
                  <span className={`badge badge-${statusTone}`}>{FILL_LEVEL_STATUS_LABEL[fillStatus]}</span>
                  <small>Cập nhật lần cuối: {compartment.updatedAt}</small>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function BinDetailPage() {
  const { id } = useParams();
  const thresholds = readSmartBinThresholds();
  const currentCompartment = demoCompartments.find((compartment) => compartment.key.toLowerCase() === (id ?? '').toLowerCase()) ?? demoCompartments[0];
  const fillStatus = getFillLevelStatus(currentCompartment.fillLevel, thresholds);
  const mappedStatus = fillStatus === 'NORMAL' ? 'BÌNH THƯỜNG' : fillStatus === 'WARNING' ? 'CẦN THEO DÕI' : fillStatus === 'NEARLY_FULL' ? 'GẦN ĐẦY' : 'ĐẦY';

  return (
    <section className="page detail-page">
      <Link className="back-link" to="/bins">← Quay lại quản lý SmartBin</Link>
      <div className="detail-heading">
        <div>
          <div className="eyebrow">CHI TIẾT NGĂN RÁC</div>
          <h1>{currentCompartment.label}</h1>
          <p>Đại diện cho một ngăn lưu trữ trong hệ thống SmartBin.</p>
        </div>
        <span className={`status-badge status-${currentCompartment.deviceState.toLowerCase()}`}>
          {currentCompartment.deviceState === 'ONLINE' ? 'Trực tuyến' : 'Ngoại tuyến'}
        </span>
      </div>

      <div className="detail-grid">
        <div className="detail-card primary-detail">
          <span className="muted">Mức độ đầy hiện tại</span>
          <strong className="detail-fill">{currentCompartment.fillLevel}%</strong>
          <div className="fill-track"><span className={`fill-value fill-${getFillTone(currentCompartment.fillLevel)}`} style={{ width: `${currentCompartment.fillLevel}%` }} /></div>
          <span className={`badge badge-${getStatusTone(mappedStatus)}`}>{FILL_LEVEL_STATUS_LABEL[fillStatus]}</span>
        </div>

        <div className="detail-card">
          <h2>Thông tin ngăn rác</h2>
          <dl>
            <dt>Loại rác</dt>
            <dd>{currentCompartment.label}</dd>
            <dt>Trạng thái</dt>
            <dd>{FILL_LEVEL_STATUS_LABEL[fillStatus]}</dd>
            <dt>Cập nhật lần cuối</dt>
            <dd>{currentCompartment.updatedAt}</dd>
            <dt>Thiết bị</dt>
            <dd>{currentCompartment.deviceState === 'ONLINE' ? 'Đang hoạt động' : 'Mất kết nối'}</dd>
          </dl>
        </div>
      </div>
    </section>
  );
}
