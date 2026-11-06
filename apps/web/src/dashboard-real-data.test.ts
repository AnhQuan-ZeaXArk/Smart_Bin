import assert from 'node:assert/strict';
import { demoService } from '../../api/src/demo/demo.service.js';
import { realDeviceService } from '../../api/src/demo/real-device.service.js';
import { DEMO_BINS } from '../../api/src/demo/demo-data.js';
import { syncBinsWithRealDevice } from '../../api/src/services/bin-sync.service.js';
import { computeBinViewModel, mergeDeviceHeartbeatToBins } from './bin-view-model.js';

console.log('=== RUNNING COMPREHENSIVE SMARTBIN UNIFIED REGRESSION TESTS (CASES 1 - 10) ===\n');

async function runTests() {
  // Setup baseline
  const now = Date.now();

  // ---------------------------------------------------------------------------------
  // Case 1: Pi OFFLINE -> Dashboard và Bins đều hiển thị "—", MẤT KẾT NỐI, không khoảng cách
  // ---------------------------------------------------------------------------------
  console.log('Case 1: Pi OFFLINE -> Cả Dashboard và Bins đều hiển thị "—" và MẤT KẾT NỐI');
  realDeviceService.setLastHeartbeatDateForTest(null);
  (realDeviceService as any).sensors = null;

  const realStatusOff = realDeviceService.getStatus();
  assert.equal(realStatusOff.status, 'OFFLINE');

  // Backend sync test
  const backendBinsOff = syncBinsWithRealDevice(DEMO_BINS, realStatusOff);
  for (const b of backendBinsOff) {
    assert.equal(b.currentFillLevel, null, `Bin ${b.binCode} must be null when Pi is OFFLINE`);
    assert.equal(b.distanceCm, null, `Bin ${b.binCode} distance must be null when Pi is OFFLINE`);
    assert.equal(b.status, 'OFFLINE', `Bin ${b.binCode} status must be OFFLINE`);
  }

  // Frontend view-model test for both Dashboard (WasteCard) and Bins (BinCard)
  for (const b of backendBinsOff) {
    const vm = computeBinViewModel(b, now);
    assert.equal(vm.isValidReading, false);
    assert.equal(vm.displayPercentage, '—', `Must display '—', got ${vm.displayPercentage}`);
    assert.equal(vm.progressWidth, '0%');
    assert.equal(vm.statusBadgeText, 'Mất kết nối');
    assert.equal(vm.hasDistance, false);
    assert.equal(vm.distanceText, null);
    assert.equal(vm.hasCapacity, false);
  }
  console.log('  -> PASS: Cả Dashboard và Bins đều hiển thị "—", MẤT KẾT NỐI, không có số giả.\n');

  // ---------------------------------------------------------------------------------
  // Case 2: API Failed to fetch -> Cả hai trang không hiển thị dữ liệu giả
  // ---------------------------------------------------------------------------------
  console.log('Case 2: API Failed to fetch -> Không hiển thị dữ liệu giả, không fallback');
  // Khi API gặp lỗi, frontend state là error, data là null.
  const vmUndefined = computeBinViewModel(undefined, now);
  assert.equal(vmUndefined.isValidReading, false);
  assert.equal(vmUndefined.displayPercentage, '—');
  assert.equal(vmUndefined.hasDistance, false);
  assert.equal(vmUndefined.hasCapacity, false);
  assert.equal(vmUndefined.statusBadgeText, 'Chưa có dữ liệu');
  console.log('  -> PASS: Khi fetch thất bại, fallback là null/unavailable, không có dữ liệu demo.\n');

  // ---------------------------------------------------------------------------------
  // Case 3: Pi ONLINE nhưng HC1, HC2, HC3 null -> Cả hai trang hiển thị CHƯA CÓ DỮ LIỆU
  // ---------------------------------------------------------------------------------
  console.log('Case 3: Pi ONLINE nhưng cảm biến HC1, HC2, HC3 null -> CHƯA CÓ DỮ LIỆU');
  const nowIso = new Date(now).toISOString();
  realDeviceService.recordHeartbeat({
    deviceId: 'raspberry-pi-5',
    uptimeSeconds: 100,
    cpuTempC: 45.0,
    sentAt: nowIso,
    sensors: {
      recyclable: null as any,
      nonRecyclable: null as any,
      organic: null as any
    }
  });

  const realStatusOnlineNoSensors = realDeviceService.getStatus();
  assert.equal(realStatusOnlineNoSensors.status, 'ONLINE');

  const syncedNoSensors = syncBinsWithRealDevice(DEMO_BINS, realStatusOnlineNoSensors);
  for (const b of syncedNoSensors) {
    assert.equal(b.currentFillLevel, null);
    assert.equal(b.distanceCm, null);
    const vm = computeBinViewModel(b, now);
    assert.equal(vm.isValidReading, false);
    assert.equal(vm.displayPercentage, '—');
    assert.notEqual(vm.displayPercentage, '0%', 'Null must not be coerced to 0%');
  }
  console.log('  -> PASS: Pi ONLINE nhưng cảm biến null -> Cả hai trang hiển thị "—", không ép thành 0%.\n');

  // ---------------------------------------------------------------------------------
  // Case 4: Chỉ HC1 có dữ liệu -> Chỉ thùng tái chế hiển thị phần trăm
  // ---------------------------------------------------------------------------------
  console.log('Case 4: Chỉ HC1 có dữ liệu (35%) -> Chỉ Rác tái chế hiển thị 35%');
  realDeviceService.recordHeartbeat({
    deviceId: 'raspberry-pi-5',
    uptimeSeconds: 105,
    cpuTempC: 45.1,
    sentAt: new Date(now).toISOString(),
    sensors: {
      recyclable: { fillLevel: 35, distanceCm: 45.5, status: 'OK', updatedAt: new Date(now).toISOString() },
      nonRecyclable: null as any,
      organic: null as any
    }
  });

  const syncedHC1 = syncBinsWithRealDevice(DEMO_BINS, realDeviceService.getStatus());
  const bRecyc1 = syncedHC1.find((b) => b.binCode === 'RECYCLABLE')!;
  const bNonRecyc1 = syncedHC1.find((b) => b.binCode === 'NON_RECYCLABLE')!;
  const bOrg1 = syncedHC1.find((b) => b.binCode === 'ORGANIC')!;

  const vmRecyc1 = computeBinViewModel(bRecyc1, now);
  const vmNonRecyc1 = computeBinViewModel(bNonRecyc1, now);
  const vmOrg1 = computeBinViewModel(bOrg1, now);

  assert.equal(vmRecyc1.isValidReading, true);
  assert.equal(vmRecyc1.displayPercentage, '35%');
  assert.equal(vmRecyc1.distanceText, '45.5 cm');

  assert.equal(vmNonRecyc1.isValidReading, false);
  assert.equal(vmNonRecyc1.displayPercentage, '—');

  assert.equal(vmOrg1.isValidReading, false);
  assert.equal(vmOrg1.displayPercentage, '—');
  console.log('  -> PASS: Chỉ HC1 (Tái chế) hiển thị 35%, 2 ngăn còn lại là "—".\n');

  // ---------------------------------------------------------------------------------
  // Case 5: Chỉ HC2 có dữ liệu -> Chỉ thùng không tái chế hiển thị phần trăm
  // ---------------------------------------------------------------------------------
  console.log('Case 5: Chỉ HC2 có dữ liệu (72%) -> Chỉ Rác không tái chế hiển thị 72%');
  realDeviceService.recordHeartbeat({
    deviceId: 'raspberry-pi-5',
    uptimeSeconds: 110,
    cpuTempC: 45.2,
    sentAt: new Date(now).toISOString(),
    sensors: {
      recyclable: null as any,
      nonRecyclable: { fillLevel: 72, distanceCm: 20.0, status: 'OK', updatedAt: new Date(now).toISOString() },
      organic: null as any
    }
  });

  const syncedHC2 = syncBinsWithRealDevice(DEMO_BINS, realDeviceService.getStatus());
  const bRecyc2 = syncedHC2.find((b) => b.binCode === 'RECYCLABLE')!;
  const bNonRecyc2 = syncedHC2.find((b) => b.binCode === 'NON_RECYCLABLE')!;
  const bOrg2 = syncedHC2.find((b) => b.binCode === 'ORGANIC')!;

  assert.equal(computeBinViewModel(bRecyc2, now).displayPercentage, '—');
  assert.equal(computeBinViewModel(bNonRecyc2, now).displayPercentage, '72%');
  assert.equal(computeBinViewModel(bNonRecyc2, now).distanceText, '20.0 cm');
  assert.equal(computeBinViewModel(bOrg2, now).displayPercentage, '—');
  console.log('  -> PASS: Chỉ HC2 (Không tái chế) hiển thị 72%, 2 ngăn còn lại là "—".\n');

  // ---------------------------------------------------------------------------------
  // Case 6: Chỉ HC3 có dữ liệu -> Chỉ thùng hữu cơ hiển thị phần trăm
  // ---------------------------------------------------------------------------------
  console.log('Case 6: Chỉ HC3 có dữ liệu (18%) -> Chỉ Rác hữu cơ hiển thị 18%');
  realDeviceService.recordHeartbeat({
    deviceId: 'raspberry-pi-5',
    uptimeSeconds: 115,
    cpuTempC: 45.3,
    sentAt: new Date(now).toISOString(),
    sensors: {
      recyclable: null as any,
      nonRecyclable: null as any,
      organic: { fillLevel: 18, distanceCm: 58.0, status: 'OK', updatedAt: new Date(now).toISOString() }
    }
  });

  const syncedHC3 = syncBinsWithRealDevice(DEMO_BINS, realDeviceService.getStatus());
  const bRecyc3 = syncedHC3.find((b) => b.binCode === 'RECYCLABLE')!;
  const bNonRecyc3 = syncedHC3.find((b) => b.binCode === 'NON_RECYCLABLE')!;
  const bOrg3 = syncedHC3.find((b) => b.binCode === 'ORGANIC')!;

  assert.equal(computeBinViewModel(bRecyc3, now).displayPercentage, '—');
  assert.equal(computeBinViewModel(bNonRecyc3, now).displayPercentage, '—');
  assert.equal(computeBinViewModel(bOrg3, now).displayPercentage, '18%');
  assert.equal(computeBinViewModel(bOrg3, now).distanceText, '58.0 cm');
  console.log('  -> PASS: Chỉ HC3 (Hữu cơ) hiển thị 18%, 2 ngăn còn lại là "—".\n');

  // ---------------------------------------------------------------------------------
  // Case 7: Dữ liệu STALE trên 15 giây -> Cả hai trang cùng chuyển unavailable
  // ---------------------------------------------------------------------------------
  console.log('Case 7: Dữ liệu STALE > 15 giây -> Cả hai trang chuyển "—" và badge STALE');
  const staleTime = new Date(now - 20000).toISOString(); // 20s ago
  const staleBin = {
    id: 'bin-1',
    binCode: 'ORGANIC',
    name: 'Rác hữu cơ',
    location: 'Ngăn rác hữu cơ',
    capacity: 240,
    currentFillLevel: 50,
    status: 'ONLINE' as const,
    fillCategory: 'MONITOR' as const,
    isActive: true,
    lastSeen: staleTime,
    createdAt: staleTime,
    updatedAt: staleTime,
    latitude: null,
    longitude: null,
    distanceCm: 30.0
  };

  const vmStale = computeBinViewModel(staleBin, now);
  assert.equal(vmStale.isStale, true);
  assert.equal(vmStale.isValidReading, false);
  assert.equal(vmStale.displayPercentage, '—');
  assert.equal(vmStale.statusBadgeText, 'Dữ liệu cũ (STALE)');
  assert.equal(vmStale.hasDistance, false);
  console.log('  -> PASS: Quá 15s không có dữ liệu -> Chuyển "—" và badge Dữ liệu cũ (STALE).\n');

  // ---------------------------------------------------------------------------------
  // Case 8: Giá trị 0% thực tế -> Cả hai trang hiển thị đúng "0%"
  // ---------------------------------------------------------------------------------
  console.log('Case 8: Giá trị 0% thực tế -> Cả hai trang hiển thị "0%", không bị nhầm thành null');
  const zeroBin = {
    id: 'bin-2',
    binCode: 'RECYCLABLE',
    name: 'Rác tái chế',
    location: 'Ngăn rác tái chế',
    capacity: 240,
    currentFillLevel: 0,
    status: 'ONLINE' as const,
    fillCategory: 'NORMAL' as const,
    isActive: true,
    lastSeen: new Date(now).toISOString(),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    latitude: null,
    longitude: null,
    distanceCm: 50.0
  };

  const vmZero = computeBinViewModel(zeroBin, now);
  assert.equal(vmZero.isValidReading, true);
  assert.equal(vmZero.fillPct, 0);
  assert.equal(vmZero.displayPercentage, '0%');
  assert.equal(vmZero.progressWidth, '0%');
  assert.equal(vmZero.hasDistance, true);
  assert.equal(vmZero.distanceText, '50.0 cm');
  console.log('  -> PASS: 0% thực tế hiển thị chuẩn xác "0%", không hiển thị "—".\n');

  // ---------------------------------------------------------------------------------
  // Case 9: Pi kết nối lại -> Cả hai trang khôi phục dữ liệu thực tế ngay lập tức
  // ---------------------------------------------------------------------------------
  console.log('Case 9: Pi kết nối lại -> Cả hai trang khôi phục dữ liệu thực tế');
  // First simulate offline
  realDeviceService.setLastHeartbeatDateForTest(null);
  const syncedBefore = syncBinsWithRealDevice(DEMO_BINS, realDeviceService.getStatus());
  assert.equal(syncedBefore[0].currentFillLevel, null);

  // Now restore with new heartbeat
  const restoreIso = new Date().toISOString();
  realDeviceService.recordHeartbeat({
    deviceId: 'raspberry-pi-5',
    uptimeSeconds: 200,
    cpuTempC: 44.5,
    sentAt: restoreIso,
    sensors: {
      recyclable: { fillLevel: 44, distanceCm: 38.0, status: 'OK', updatedAt: restoreIso },
      nonRecyclable: { fillLevel: 77, distanceCm: 16.5, status: 'OK', updatedAt: restoreIso },
      organic: { fillLevel: 22, distanceCm: 52.0, status: 'OK', updatedAt: restoreIso }
    }
  });

  const syncedAfter = syncBinsWithRealDevice(DEMO_BINS, realDeviceService.getStatus());
  assert.equal(syncedAfter.find((b) => b.binCode === 'RECYCLABLE')!.currentFillLevel, 44);
  assert.equal(syncedAfter.find((b) => b.binCode === 'NON_RECYCLABLE')!.currentFillLevel, 77);
  assert.equal(syncedAfter.find((b) => b.binCode === 'ORGANIC')!.currentFillLevel, 22);

  // Realtime merge to bins state in bins.tsx
  const mergedBins = mergeDeviceHeartbeatToBins(syncedBefore as any, realDeviceService.getStatus());
  assert.equal(mergedBins.find((b) => b.binCode === 'RECYCLABLE')!.currentFillLevel, 44);
  assert.equal(mergedBins.find((b) => b.binCode === 'NON_RECYCLABLE')!.currentFillLevel, 77);
  assert.equal(mergedBins.find((b) => b.binCode === 'ORGANIC')!.currentFillLevel, 22);
  console.log('  -> PASS: Kết nối lại khôi phục đúng 44%, 77%, 22% trên cả hai trang.\n');

  // ---------------------------------------------------------------------------------
  // Case 10: Không xuất hiện lại các giá trị demo (25%, 58%, 78%, 22cm, 75cm, 42cm) khi Pi Offline
  // ---------------------------------------------------------------------------------
  console.log('Case 10: Xác nhận các giá trị demo (25%, 58%, 78%, 22cm, 75cm, 42cm) KHÔNG BAO GIỜ xuất hiện khi Pi Offline');
  realDeviceService.setLastHeartbeatDateForTest(null);
  (realDeviceService as any).sensors = null;

  const summaryCheck = demoService.getDashboardSummary();
  const allBinsCheck = demoService.getAllBins();

  const forbiddenFills = [25, 58, 78];
  const forbiddenDistances = [22, 42, 75];

  for (const b of [...summaryCheck.bins, ...allBinsCheck]) {
    assert.equal(forbiddenFills.includes(b.currentFillLevel as number), false, `Forbidden demo fill ${b.currentFillLevel} detected!`);
    assert.equal(forbiddenDistances.includes(b.distanceCm as number), false, `Forbidden demo distance ${b.distanceCm} detected!`);
    assert.equal(b.currentFillLevel, null);
    assert.equal(b.distanceCm, null);
    assert.equal(b.status, 'OFFLINE');
  }
  console.log('  -> PASS: Không có bất kỳ giá trị demo nào tồn tại khi Pi Offline.\n');

  console.log('=== ALL 10 REGRESSION TESTS PASSED CLEANLY! ===\n');
}

runTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
