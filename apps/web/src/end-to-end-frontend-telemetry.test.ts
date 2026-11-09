import assert from 'node:assert';
import {
  computeBinViewModel,
  mergeDeviceHeartbeatToBins,
  groupBinsByStation,
  DEFAULT_STATION_CONFIG,
  createDefaultStationBBins,
  type Bin
} from './bin-view-model.js';

/**
 * End-to-End Frontend Telemetry Test Suite:
 * 1. Initial API Data Loading & Model Computation
 * 2. Station A realtime heartbeat updates Station A bins
 * 3. Station B realtime heartbeat updates Station B bins
 * 4. All-stations view displays both Station A and Station B
 * 5. Individual station filtering isolates stations
 * 6. Stale sensor data (> 15s) safely switches to '—' (STALE badge)
 * 7. Offline device sets isValidReading = false, displayPercentage = '—', preserves lastKnownFillPct
 * 8. Late/Null API response does NOT overwrite newer realtime reading
 * 9. Strict isolation: Station A heartbeat never updates Station B bins and vice versa
 * 10. NOT_INSTALLED bins (Station B ORGANIC & NON_RECYCLABLE) always display '—' ('Chưa lắp đặt')
 */

function runFrontendEndToEndTests() {
  console.log('================================================================');
  console.log('  RUNNING END-TO-END FRONTEND TELEMETRY FIX TEST SUITE');
  console.log('================================================================\n');

  const now = Date.now();

  // Test 1: Khởi tạo dữ liệu ban đầu
  console.log('Test 1: Initial API Data Loading & Model Computation');
  const initialBins: (Bin & { distanceCm: number | null; isReal: boolean })[] = [
    // 3 bin Trạm A (Production hiện tại có stationId = null)
    { id: 'bin_a_rec', stationId: null as any, binCode: 'RECYCLABLE', name: 'Rác tái chế', location: 'Trạm A', capacity: 240, currentFillLevel: null, status: 'OFFLINE', isActive: true, installed: true, lastSeen: null, createdAt: '', updatedAt: '', distanceCm: null, isReal: true },
    { id: 'bin_a_non', stationId: null as any, binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế', location: 'Trạm A', capacity: 360, currentFillLevel: null, status: 'OFFLINE', isActive: true, installed: true, lastSeen: null, createdAt: '', updatedAt: '', distanceCm: null, isReal: true },
    { id: 'bin_a_org', stationId: null as any, binCode: 'ORGANIC', name: 'Rác hữu cơ', location: 'Trạm A', capacity: 240, currentFillLevel: null, status: 'OFFLINE', isActive: true, installed: true, lastSeen: null, createdAt: '', updatedAt: '', distanceCm: null, isReal: true },
    // 3 bin Trạm B
    ...createDefaultStationBBins()
  ];

  const vmInitialRecA = computeBinViewModel(initialBins[0], now);
  assert.strictEqual(vmInitialRecA.isValidReading, false);
  assert.strictEqual(vmInitialRecA.displayPercentage, '—');
  assert.strictEqual(vmInitialRecA.statusBadgeText, 'Mất kết nối');
  console.log('  -> PASS: Dữ liệu khởi tạo hiển thị "—" an toàn khi chưa có heartbeat\n');

  // Test 2: Nhận Realtime Heartbeat Trạm A
  console.log('Test 2: Station A Realtime Heartbeat Updates Station A Bins');
  const hbStationA = {
    stationCode: 'STATION_A',
    deviceId: 'raspberry-pi-5',
    status: 'ONLINE',
    uptimeSeconds: 500,
    lastHeartbeat: new Date(now).toISOString(),
    sensors: {
      recyclable: { fillLevel: 58, distanceCm: 19.5, status: 'OK', updatedAt: new Date(now).toISOString() },
      nonRecyclable: { fillLevel: 74, distanceCm: 13.0, status: 'OK', updatedAt: new Date(now).toISOString() },
      organic: { fillLevel: 32, distanceCm: 28.0, status: 'OK', updatedAt: new Date(now).toISOString() }
    }
  };

  const afterHbA = mergeDeviceHeartbeatToBins(initialBins, hbStationA);
  const binARec = afterHbA.find((b) => b.id === 'bin_a_rec')!;
  const vmARec = computeBinViewModel(binARec, now);
  assert.strictEqual(vmARec.isValidReading, true);
  assert.strictEqual(vmARec.displayPercentage, '58%');
  assert.strictEqual(vmARec.statusBadgeText, 'Trực tuyến');

  const binANon = afterHbA.find((b) => b.id === 'bin_a_non')!;
  assert.strictEqual(computeBinViewModel(binANon, now).displayPercentage, '74%');

  const binAOrg = afterHbA.find((b) => b.id === 'bin_a_org')!;
  assert.strictEqual(computeBinViewModel(binAOrg, now).displayPercentage, '32%');
  console.log('  -> PASS: Cả 3 ngăn rác Trạm A cập nhật chính xác (58%, 74%, 32%)\n');

  // Test 3: Nhận Realtime Heartbeat Trạm B
  console.log('Test 3: Station B Realtime Heartbeat Updates Station B Bins');
  const hbStationB = {
    stationCode: 'STATION_B',
    deviceId: 'esp32c6-station-b',
    status: 'ONLINE',
    uptimeSeconds: 300,
    lastHeartbeat: new Date(now).toISOString(),
    sensors: {
      recyclable: { fillLevel: 88, distanceCm: 8.5, status: 'OK', updatedAt: new Date(now).toISOString() }
    }
  };

  const afterHbB = mergeDeviceHeartbeatToBins(afterHbA, hbStationB);
  const binBRec = afterHbB.find((b) => b.stationCode === 'STATION_B' && b.binCode === 'RECYCLABLE')!;
  const vmBRec = computeBinViewModel(binBRec, now);
  assert.strictEqual(vmBRec.isValidReading, true);
  assert.strictEqual(vmBRec.displayPercentage, '88%');
  assert.strictEqual(vmBRec.statusBadgeText, 'Trực tuyến');
  console.log('  -> PASS: Ngăn Recyclable Trạm B cập nhật chính xác (88%)\n');

  // Test 4: Cách ly dữ liệu giữa 2 trạm (Không ghi đè chéo)
  console.log('Test 4: Strict Station Isolation (No Cross-Contamination)');
  const binARecCheck = afterHbB.find((b) => b.id === 'bin_a_rec')!;
  assert.strictEqual(binARecCheck.currentFillLevel, 58, 'Station A Recyclable must remain 58%, not overwritten by Station B 88%');
  console.log('  -> PASS: Trạm A và Trạm B cách ly hoàn toàn, không ghi đè chéo\n');

  // Test 5: Ngăn rác chưa lắp đặt của Trạm B
  console.log('Test 5: NOT_INSTALLED Bins (Station B Organic & Non-recyclable)');
  const binBOrg = afterHbB.find((b) => b.stationCode === 'STATION_B' && b.binCode === 'ORGANIC')!;
  const vmBOrg = computeBinViewModel(binBOrg, now);
  assert.strictEqual(vmBOrg.isValidReading, false);
  assert.strictEqual(vmBOrg.displayPercentage, '—');
  assert.strictEqual(vmBOrg.statusBadgeText, 'Chưa lắp đặt');
  assert.strictEqual(vmBOrg.isUninstalled, true);
  console.log('  -> PASS: Ngăn chưa lắp đặt hiển thị "—" và badge "Chưa lắp đặt"\n');

  // Test 6: Dữ liệu STALE (> 15s)
  console.log('Test 6: Stale Sensor Data (> 15s) Detection');
  const futureNow = now + 16000; // 16s sau
  const vmStale = computeBinViewModel(binARec, futureNow);
  assert.strictEqual(vmStale.isStale, true);
  assert.strictEqual(vmStale.isValidReading, false);
  assert.strictEqual(vmStale.displayPercentage, '—');
  assert.strictEqual(vmStale.statusBadgeText, 'Dữ liệu cũ (STALE)');
  assert.strictEqual(vmStale.lastKnownFillPct, 58, 'Preserves last known percentage 58%');
  console.log('  -> PASS: Quá 15s chuyển thành STALE, hiển thị "—" và giữ lại giá trị gần nhất 58%\n');

  // Test 7: Mất kết nối (OFFLINE) bảo toàn giá trị gần nhất
  console.log('Test 7: Offline Event Preserves Last Known Fill Level');
  const hbOfflineA = {
    stationCode: 'STATION_A',
    deviceId: 'raspberry-pi-5',
    status: 'OFFLINE',
    lastHeartbeat: new Date(now).toISOString()
  };
  const afterOffline = mergeDeviceHeartbeatToBins(afterHbB, hbOfflineA);
  const binAOff = afterOffline.find((b) => b.id === 'bin_a_rec')!;
  const vmOff = computeBinViewModel(binAOff, now);
  assert.strictEqual(vmOff.isOffline, true);
  assert.strictEqual(vmOff.isValidReading, false);
  assert.strictEqual(vmOff.displayPercentage, '—');
  assert.strictEqual(vmOff.statusBadgeText, 'Mất kết nối');
  assert.strictEqual(vmOff.lastKnownFillPct, 58, 'Last known fill level preserved across OFFLINE event');
  assert.strictEqual(vmOff.lastKnownText, 'Gần nhất: 58%');
  console.log('  -> PASS: Mất kết nối hiển thị "—" và giữ nguyên nhãn (Gần nhất: 58%)\n');

  // Test 8: All-stations Grouping
  console.log('Test 8: All-Stations Grouping');
  const groups = groupBinsByStation(afterHbB, DEFAULT_STATION_CONFIG, now);
  assert.strictEqual(groups.length, 2, 'Must group into 2 stations (A and B)');
  const groupA = groups.find((g) => g.code === 'STATION_A')!;
  const groupB = groups.find((g) => g.code === 'STATION_B')!;
  assert.strictEqual(groupA.status, 'ONLINE');
  assert.strictEqual(groupB.status, 'ONLINE');
  assert.strictEqual(groupA.installedCount, 3);
  assert.strictEqual(groupB.installedCount, 1);
  console.log('  -> PASS: Phân nhóm trạm hiển thị đồng thời Trạm A (3 thùng) và Trạm B (1 thùng lắp đặt)\n');

  // Test 9: Station A với mức đầy thực tế 0% (HC1: 0%, HC2: 0%, HC3: 0%)
  console.log('Test 9: Station A Zero Percent Fill Levels (HC1: 0%, HC2: 0%, HC3: 0%)');
  const hbZeroA = {
    stationCode: 'STATION_A',
    deviceId: 'raspberry-pi-5',
    status: 'ONLINE',
    uptimeSeconds: 600,
    lastHeartbeat: new Date(now).toISOString(),
    sensors: {
      recyclable: { fillLevel: 0, distanceCm: 50.0, status: 'OK', updatedAt: new Date(now).toISOString() },
      nonRecyclable: { fillLevel: 0, distanceCm: 50.0, status: 'OK', updatedAt: new Date(now).toISOString() },
      organic: { fillLevel: 0, distanceCm: 50.0, status: 'OK', updatedAt: new Date(now).toISOString() }
    }
  };
  const afterZeroA = mergeDeviceHeartbeatToBins(initialBins, hbZeroA);
  for (const code of ['RECYCLABLE', 'NON_RECYCLABLE', 'ORGANIC'] as const) {
    const bin = afterZeroA.find((b) => b.binCode === code && (b.stationCode === 'STATION_A' || !b.stationCode))!;
    const vm = computeBinViewModel(bin, now);
    assert.strictEqual(vm.isValidReading, true, `${code} reading must be valid`);
    assert.strictEqual(vm.isStale, false, `${code} must not be stale`);
    assert.strictEqual(vm.displayPercentage, '0%', `${code} must display "0%", not "—"`);
    assert.strictEqual(vm.statusBadgeText, 'Trực tuyến', `${code} must be "Trực tuyến"`);
  }
  console.log('  -> PASS: Cả 3 ngăn rác Trạm A hiển thị chuẩn xác "0%", không bị nhầm thành null hay STALE\n');

  // Test 10: device:status (không có trường sensors) không được xóa dữ liệu ngăn rác
  console.log('Test 10: Sensorless device:status ping preserves active bin readings');
  const sensorlessDeviceStatus = {
    deviceId: 'raspberry-pi-5',
    deviceType: 'RASPBERRY_PI',
    stationCode: 'STATION_A',
    status: 'ONLINE',
    uptimeSeconds: 610,
    cpuTempC: 48.2,
    lastHeartbeat: new Date(now + 2000).toISOString()
    // Lưu ý: Không có trường sensors!
  };
  const afterSensorlessStatus = mergeDeviceHeartbeatToBins(afterZeroA, sensorlessDeviceStatus);
  for (const code of ['RECYCLABLE', 'NON_RECYCLABLE', 'ORGANIC'] as const) {
    const bin = afterSensorlessStatus.find((b) => b.binCode === code && (b.stationCode === 'STATION_A' || !b.stationCode))!;
    assert.strictEqual(bin.currentFillLevel, 0, `${code} currentFillLevel must NOT be wiped to null by sensorless status`);
    const vm = computeBinViewModel(bin, now + 2000);
    assert.strictEqual(vm.displayPercentage, '0%', `${code} must remain "0%"`);
    assert.strictEqual(vm.statusBadgeText, 'Trực tuyến');
  }
  console.log('  -> PASS: Sự kiện device:status không làm mất dữ liệu cảm biến của các thùng rác\n');

  // Test 11: Khả năng chống lệch đồng hồ (Clock Skew Tolerance)
  console.log('Test 11: Clock Skew Tolerance (Pi hardware time behind browser/server clock)');
  const piClockSkewTime = now - 25000; // Đồng hồ Pi bị trễ 25 giây
  const hbClockSkew = {
    stationCode: 'STATION_A',
    deviceId: 'raspberry-pi-5',
    status: 'ONLINE',
    sentAt: new Date(piClockSkewTime).toISOString(), // Giờ Pi gửi bản tin (trễ 25s)
    lastHeartbeat: new Date(now).toISOString(), // Server nhận gói tin ngay lúc này (fresh)
    receivedAt: new Date(now).toISOString(),
    sensors: {
      recyclable: { fillLevel: 45, distanceCm: 25.0, status: 'OK', updatedAt: new Date(piClockSkewTime).toISOString() },
      nonRecyclable: { fillLevel: 60, distanceCm: 18.0, status: 'OK', updatedAt: new Date(piClockSkewTime).toISOString() },
      organic: { fillLevel: 15, distanceCm: 40.0, status: 'OK', updatedAt: new Date(piClockSkewTime).toISOString() }
    }
  };
  const afterClockSkew = mergeDeviceHeartbeatToBins(initialBins, hbClockSkew);
  const binSkewRec = afterClockSkew.find((b) => b.binCode === 'RECYCLABLE' && (b.stationCode === 'STATION_A' || !b.stationCode))!;
  const vmSkewRec = computeBinViewModel(binSkewRec, now);
  assert.strictEqual(vmSkewRec.isStale, false, 'Must NOT be marked STALE due to Pi clock drift when lastHeartbeat is fresh');
  assert.strictEqual(vmSkewRec.isValidReading, true);
  assert.strictEqual(vmSkewRec.displayPercentage, '45%');
  console.log('  -> PASS: Đồng hồ Pi bị trễ không gây ra hiện tượng STALE giả khi luồng nhịp tim vẫn trực tuyến\n');

  // Test 12: Gói tin cũ (Old timestamp) bị loại bỏ đúng quy cách
  console.log('Test 12: Stale out-of-order heartbeat is dropped cleanly');
  const olderHeartbeat = {
    stationCode: 'STATION_A',
    deviceId: 'raspberry-pi-5',
    status: 'ONLINE',
    sentAt: new Date(now - 60000).toISOString(),
    lastHeartbeat: new Date(now - 60000).toISOString(), // 60s trước
    sensors: {
      recyclable: { fillLevel: 99, distanceCm: 2.0, status: 'OK', updatedAt: new Date(now - 60000).toISOString() }
    }
  };
  const afterOlder = mergeDeviceHeartbeatToBins(afterClockSkew, olderHeartbeat);
  const binDroppedCheck = afterOlder.find((b) => b.binCode === 'RECYCLABLE' && (b.stationCode === 'STATION_A' || !b.stationCode))!;
  assert.strictEqual(binDroppedCheck.currentFillLevel, 45, 'Must keep 45% and drop 99% from older heartbeat');
  console.log('  -> PASS: Gói tin cũ hơn không ghi đè dữ liệu mới\n');

  // Test 13: Cảm biến riêng lẻ bị STALE (>15s) trong khi nhịp tim Pi vẫn trực tuyến
  console.log('Test 13: Single sensor STALE while Pi heartbeat is fresh (Sensor measurement time != Heartbeat time)');
  const hbPartialStale = {
    stationCode: 'STATION_A',
    deviceId: 'raspberry-pi-5',
    status: 'ONLINE',
    sentAt: new Date(now).toISOString(),
    lastHeartbeat: new Date(now).toISOString(),
    receivedAt: new Date(now).toISOString(),
    sensors: {
      recyclable: { fillLevel: 0, distanceCm: 50.0, status: 'OK', updatedAt: new Date(now).toISOString() }, // Fresh
      nonRecyclable: { fillLevel: 60, distanceCm: 20.0, status: 'OK', updatedAt: new Date(now).toISOString() }, // Fresh
      organic: { fillLevel: 3, distanceCm: 48.0, status: 'OK', updatedAt: new Date(now - 20000).toISOString() } // 20s old measurement!
    }
  };
  const afterPartialStale = mergeDeviceHeartbeatToBins(initialBins, hbPartialStale);
  const binRecCheck = afterPartialStale.find((b) => b.binCode === 'RECYCLABLE' && (b.stationCode === 'STATION_A' || !b.stationCode))!;
  const binOrgCheck = afterPartialStale.find((b) => b.binCode === 'ORGANIC' && (b.stationCode === 'STATION_A' || !b.stationCode))!;

  const vmRecFresh = computeBinViewModel(binRecCheck, now);
  const vmOrgStale = computeBinViewModel(binOrgCheck, now);

  assert.strictEqual(vmRecFresh.isValidReading, true, 'Recyclable must remain valid ONLINE');
  assert.strictEqual(vmRecFresh.displayPercentage, '0%');

  assert.strictEqual(vmOrgStale.isStale, true, 'Organic must be detected as STALE based on sensor measurement delay (>15s)');
  assert.strictEqual(vmOrgStale.isValidReading, false);
  assert.strictEqual(vmOrgStale.displayPercentage, '—');
  assert.strictEqual(vmOrgStale.lastKnownFillPct, 3, 'Preserves last known 3%');
  console.log('  -> PASS: Cảm biến riêng lẻ quá hạn (>15s) chuyển thành STALE chính xác, không bị nhầm bởi thời gian nhịp tim\n');

  console.log('================================================================');
  console.log('  ALL 13 END-TO-END FRONTEND TELEMETRY TESTS PASSED CLEANLY (13/13)!');
  console.log('================================================================\n');
}

runFrontendEndToEndTests();

