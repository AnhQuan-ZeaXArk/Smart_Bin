import assert from 'node:assert/strict';
import { DEFAULT_THRESHOLDS, type SmartBinThresholds } from './threshold-config.js';

console.log('=== RUNNING SMARTBIN SETTINGS THRESHOLD NOTIFICATION & SYNC TESTS ===\n');

/**
 * Mô phỏng logic xử lý trạng thái và thông báo trong SettingsPage
 */
interface SelfSaveTracker {
  isSaving: boolean;
  thresholds: SmartBinThresholds | null;
  savedAt: number;
  updatedAt?: string;
}

interface SimulatedSettingsState {
  settings: SmartBinThresholds;
  status: string;
  remoteNotice: string;
  thresholdError: string;
  latestTimestamp: number;
  tracker: SelfSaveTracker;
}

function createInitialState(): SimulatedSettingsState {
  return {
    settings: { ...DEFAULT_THRESHOLDS },
    status: '',
    remoteNotice: '',
    thresholdError: '',
    latestTimestamp: 0,
    tracker: {
      isSaving: false,
      thresholds: null,
      savedAt: 0
    }
  };
}

/**
 * Xử lý khi người dùng nhấn "Lưu thay đổi" (gửi PUT và nhận response thành công)
 */
function simulateSaveSuccess(
  state: SimulatedSettingsState,
  newThresholds: SmartBinThresholds,
  serverUpdatedAt: string
) {
  // Bắt đầu lưu
  state.thresholdError = '';
  state.status = '';
  state.remoteNotice = '';
  state.tracker = {
    isSaving: true,
    thresholds: { ...newThresholds },
    savedAt: Date.now()
  };

  // Response thành công từ server
  state.settings = { ...newThresholds };
  state.latestTimestamp = new Date(serverUpdatedAt).getTime();
  state.tracker = {
    isSaving: false,
    thresholds: { ...newThresholds },
    savedAt: Date.now(),
    updatedAt: serverUpdatedAt
  };
  state.status = 'Lưu ngưỡng thành công!';
  state.remoteNotice = '';
}

/**
 * Xử lý khi nhận sự kiện Socket.IO 'settings:thresholds:updated'
 */
function simulateSocketThresholdsUpdated(
  state: SimulatedSettingsState,
  payload: {
    warningThreshold: number;
    nearFullThreshold: number;
    fullThreshold: number;
    updatedAt: string;
  }
) {
  const incomingTime = payload.updatedAt ? new Date(payload.updatedAt).getTime() : Date.now();

  // Chống race condition
  if (incomingTime && incomingTime < state.latestTimestamp) {
    return;
  }
  state.latestTimestamp = incomingTime;

  const nextThresholds: SmartBinThresholds = {
    warningThreshold: Number(payload.warningThreshold),
    nearFullThreshold: Number(payload.nearFullThreshold),
    fullThreshold: Number(payload.fullThreshold)
  };

  state.settings = { ...nextThresholds };
  state.thresholdError = '';

  // Phân biệt nguồn phát sinh sự kiện
  const tracker = state.tracker;
  const isMatchingThresholds =
    tracker.thresholds !== null &&
    tracker.thresholds.warningThreshold === nextThresholds.warningThreshold &&
    tracker.thresholds.nearFullThreshold === nextThresholds.nearFullThreshold &&
    tracker.thresholds.fullThreshold === nextThresholds.fullThreshold;

  const isSelfSaveEcho =
    tracker.isSaving ||
    (Boolean(tracker.updatedAt) && tracker.updatedAt === String(payload.updatedAt)) ||
    (isMatchingThresholds && Date.now() - tracker.savedAt < 10_000);

  if (isSelfSaveEcho) {
    // Sự kiện vọng lại từ chính thao tác lưu của thiết bị hiện tại
    state.remoteNotice = '';
  } else {
    // Sự kiện thực sự từ thiết bị khác
    state.status = '';
    state.remoteNotice = 'Cấu hình đã được cập nhật bởi một thiết bị khác.';
  }
}

/**
 * Xử lý khi người dùng chỉnh sửa trường ngưỡng trên UI
 */
function simulateFieldChange(state: SimulatedSettingsState, field: keyof SmartBinThresholds, value: number) {
  state.settings[field] = value;
  state.status = '';
  state.remoteNotice = '';
}

function runAllTests() {
  // Test 1: Khi lưu ngưỡng thành công, chỉ hiển thị "Lưu ngưỡng thành công!"
  console.log('Test 1: Khi lưu ngưỡng thành công -> Hiển thị "Lưu ngưỡng thành công!"');
  const deviceA = createInitialState();
  const testThresholdsA: SmartBinThresholds = {
    warningThreshold: 45,
    nearFullThreshold: 65,
    fullThreshold: 85
  };
  const updatedAtA = new Date().toISOString();

  simulateSaveSuccess(deviceA, testThresholdsA, updatedAtA);
  assert.equal(deviceA.status, 'Lưu ngưỡng thành công!', 'Status must be exactly "Lưu ngưỡng thành công!"');
  assert.equal(deviceA.remoteNotice, '', 'remoteNotice must be empty after save');
  console.log('  -> PASS: Đã hiển thị thông báo ngắn gọn "Lưu ngưỡng thành công!", không có remote notice.\n');

  // Test 2: Khi Socket.IO broadcast vọng lại từ chính thao tác lưu của Device A
  console.log('Test 2: Socket.IO event vọng lại từ chính thao tác lưu của Device A');
  simulateSocketThresholdsUpdated(deviceA, {
    ...testThresholdsA,
    updatedAt: updatedAtA
  });
  assert.equal(deviceA.status, 'Lưu ngưỡng thành công!', 'Save status must remain intact');
  assert.equal(deviceA.remoteNotice, '', 'remoteNotice MUST NOT appear for self save');
  console.log('  -> PASS: Không hiển thị "Cấu hình đã được cập nhật bởi một thiết bị khác." cho chính thiết bị lưu.\n');

  // Test 3: Khi Socket.IO event đến TRƯỚC khi response HTTP hoàn tất (tracker.isSaving = true)
  console.log('Test 3: Socket.IO event đến trước khi response HTTP hoàn tất (isSaving = true)');
  const deviceRace = createInitialState();
  deviceRace.tracker = {
    isSaving: true,
    thresholds: { warningThreshold: 40, nearFullThreshold: 60, fullThreshold: 80 },
    savedAt: Date.now()
  };

  simulateSocketThresholdsUpdated(deviceRace, {
    warningThreshold: 40,
    nearFullThreshold: 60,
    fullThreshold: 80,
    updatedAt: new Date().toISOString()
  });
  assert.equal(deviceRace.remoteNotice, '', 'Must not show remote notice during active self-save');
  console.log('  -> PASS: Hoàn toàn không bị dính remote notice khi socket event đến sớm.\n');

  // Test 4: Khi một thiết bị khác (Device B) thực sự thay đổi cấu hình -> Device A cập nhật và hiển thị thông báo
  console.log('Test 4: Thiết bị khác (Device B) cập nhật ngưỡng -> Device A nhận dữ liệu và hiển thị remote notice');
  const remoteThresholdsB = {
    warningThreshold: 55,
    nearFullThreshold: 75,
    fullThreshold: 95,
    updatedAt: new Date(Date.now() + 1000).toISOString()
  };

  simulateSocketThresholdsUpdated(deviceA, remoteThresholdsB);
  assert.equal(deviceA.settings.warningThreshold, 55, 'Device A warningThreshold must be updated to 55');
  assert.equal(deviceA.settings.nearFullThreshold, 75, 'Device A nearFullThreshold must be updated to 75');
  assert.equal(deviceA.settings.fullThreshold, 95, 'Device A fullThreshold must be updated to 95');
  assert.equal(deviceA.status, '', 'Previous self-save status must be cleared');
  assert.equal(deviceA.remoteNotice, 'Cấu hình đã được cập nhật bởi một thiết bị khác.', 'Remote notice must be displayed');
  console.log('  -> PASS: Device A đã cập nhật đúng cấu hình từ Device B và hiển thị thông báo thiết bị khác.\n');

  // Test 5: Khi người dùng chỉnh sửa trường -> Xóa cả status và remote notice
  console.log('Test 5: Người dùng bắt đầu chỉnh sửa input -> Xóa cả status và remote notice');
  simulateFieldChange(deviceA, 'warningThreshold', 50);
  assert.equal(deviceA.status, '', 'Status must be cleared on field edit');
  assert.equal(deviceA.remoteNotice, '', 'Remote notice must be cleared on field edit');
  assert.equal(deviceA.settings.warningThreshold, 50, 'Value must be updated to 50');
  console.log('  -> PASS: Giao diện phản hồi tức thì, xóa sạch thông báo cũ khi nhập liệu.\n');

  console.log('=== ALL SETTINGS THRESHOLD NOTIFICATION & SYNC TESTS PASSED CLEANLY (5/5) ===\n');
}

runAllTests();

