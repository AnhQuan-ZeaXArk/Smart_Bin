import assert from 'node:assert';
import {
  computeBinViewModel,
  mergeDeviceHeartbeatToBins,
  mergeRestBinsWithRealtimeState,
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

  // Test 14: Station A UI Progress Bar & Fill Percentages (0%, 4%, 60%, 100%, and Clamping)
  console.log('Test 14: Station A UI Progress Bar & Proportional Widths (0%, 4%, 60%, 100%)');
  const bin0 = { ...initialBins[0], currentFillLevel: 0, status: 'ONLINE' as const, lastSeen: new Date(now).toISOString() };
  const bin4 = { ...initialBins[2], currentFillLevel: 4, status: 'ONLINE' as const, lastSeen: new Date(now).toISOString() };
  const bin60 = { ...initialBins[1], currentFillLevel: 60, status: 'ONLINE' as const, lastSeen: new Date(now).toISOString() };
  const bin100 = { ...initialBins[0], currentFillLevel: 100, status: 'ONLINE' as const, lastSeen: new Date(now).toISOString() };
  const binOver120 = { ...initialBins[0], currentFillLevel: 125, status: 'ONLINE' as const, lastSeen: new Date(now).toISOString() };
  const binNegative = { ...initialBins[0], currentFillLevel: -10, status: 'ONLINE' as const, lastSeen: new Date(now).toISOString() };

  const vm0 = computeBinViewModel(bin0, now);
  assert.strictEqual(vm0.displayPercentage, '0%');
  assert.strictEqual(vm0.progressWidth, '0%');

  const vm4 = computeBinViewModel(bin4, now);
  assert.strictEqual(vm4.displayPercentage, '4%');
  assert.strictEqual(vm4.progressWidth, '4%');

  const vm60 = computeBinViewModel(bin60, now);
  assert.strictEqual(vm60.displayPercentage, '60%');
  assert.strictEqual(vm60.progressWidth, '60%');

  const vm100 = computeBinViewModel(bin100, now);
  assert.strictEqual(vm100.displayPercentage, '100%');
  assert.strictEqual(vm100.progressWidth, '100%');

  const vmClampedHigh = computeBinViewModel(binOver120, now);
  assert.strictEqual(vmClampedHigh.displayPercentage, '100%');
  assert.strictEqual(vmClampedHigh.progressWidth, '100%');

  const vmClampedLow = computeBinViewModel(binNegative, now);
  assert.strictEqual(vmClampedLow.displayPercentage, '0%');
  assert.strictEqual(vmClampedLow.progressWidth, '0%');
  console.log('  -> PASS: 0% thanh rỗng, 4% tỉ lệ, 60% tỉ lệ, 100% đầy, giá trị được clamp 0-100 chuẩn xác\n');

  // Test 15: Null / Missing measurement remains unavailable ('—'), never converted to 0%
  console.log('Test 15: Missing/Null measurement remains unavailable ("—") with empty bar, never converted to 0%');
  const binNull = { ...initialBins[0], currentFillLevel: null, status: 'ONLINE' as const, lastSeen: new Date(now).toISOString() };
  const binUndefined = { ...initialBins[0], currentFillLevel: undefined, status: 'ONLINE' as const, lastSeen: new Date(now).toISOString() };

  const vmNull = computeBinViewModel(binNull, now);
  assert.strictEqual(vmNull.isValidReading, false);
  assert.strictEqual(vmNull.displayPercentage, '—');
  assert.strictEqual(vmNull.progressWidth, '0%');

  const vmUndef = computeBinViewModel(binUndefined, now);
  assert.strictEqual(vmUndef.isValidReading, false);
  assert.strictEqual(vmUndef.displayPercentage, '—');
  assert.strictEqual(vmUndef.progressWidth, '0%');
  console.log('  -> PASS: Dữ liệu null/undefined luôn hiển thị "—", không bị biến thành 0%\n');

  // Test 16: Simplified Card Representation
  console.log('Test 16: Simplified Card Data Model Integrity');
  // Khi cảm biến hoạt động bình thường, ViewModel tính toán chính xác
  assert.strictEqual(vm4.fillPct, 4);
  assert.strictEqual(vm4.isValidReading, true);
  assert.strictEqual(vm4.tone, 'normal');
  // Khi offline, bảo toàn cờ và không tạo số giả
  const vmOffline = computeBinViewModel({ ...bin4, status: 'OFFLINE' as const }, now);
  assert.strictEqual(vmOffline.isValidReading, false);
  assert.strictEqual(vmOffline.displayPercentage, '—');
  console.log('  -> PASS: Giao diện thẻ thùng rác tinh giản, phản ánh chính xác dữ liệu từ cảm biến thực\n');

  // Test 17: Scenario HC1=67%, HC2=21%, HC3=null (YOLO=RUNNING, Camera=CONNECTED)
  console.log('Test 17: Realistic Scenario HC1=67%, HC2=21%, HC3=null');
  const now17 = Date.now();
  const realisticStationAHeartbeat = {
    stationCode: 'STATION_A',
    deviceId: 'pi-gateway-01',
    status: 'ONLINE',
    sentAt: new Date(now17 - 100).toISOString(),
    receivedAt: new Date(now17 - 50).toISOString(),
    lastHeartbeat: new Date(now17 - 50).toISOString(),
    subsystems: {
      yolo: 'RUNNING',
      camera: 'CONNECTED'
    },
    sensors: {
      recyclable: {
        fillLevel: 67,
        fillPercent: 67,
        status: 'OK',
        updatedAt: new Date(now17 - 500).toISOString()
      },
      nonRecyclable: {
        fillLevel: 21,
        fillPercent: 21,
        status: 'OK',
        updatedAt: new Date(now17 - 500).toISOString()
      }
      // HC3 is null / absent
    }
  };

  const updatedBins17 = mergeDeviceHeartbeatToBins(initialBins, realisticStationAHeartbeat);
  const recBin = updatedBins17.find((b) => b.binCode === 'RECYCLABLE')!;
  const nonRecBin = updatedBins17.find((b) => b.binCode === 'NON_RECYCLABLE')!;
  const orgBin = updatedBins17.find((b) => b.binCode === 'ORGANIC')!;

  const vmRec = computeBinViewModel(recBin, now17);
  const vmNonRec = computeBinViewModel(nonRecBin, now17);
  const vmOrg = computeBinViewModel(orgBin, now17);

  // Recyclable: 67%
  assert.strictEqual(vmRec.isValidReading, true);
  assert.strictEqual(vmRec.displayPercentage, '67%');
  assert.strictEqual(vmRec.progressWidth, '67%');

  // Non-recyclable: 21%
  assert.strictEqual(vmNonRec.isValidReading, true);
  assert.strictEqual(vmNonRec.displayPercentage, '21%');
  assert.strictEqual(vmNonRec.progressWidth, '21%');

  // Organic: null -> '—' (KHÔNG bị biến thành 0%)
  assert.strictEqual(vmOrg.isValidReading, false);
  assert.strictEqual(vmOrg.displayPercentage, '—');
  assert.strictEqual(vmOrg.progressWidth, '0%');
  assert.strictEqual(vmOrg.hasValidFillLevel, false);

  // Station Group Header: Tính trung bình chỉ từ các ngăn hợp lệ (67 + 21) / 2 = 44%
  const groups17 = groupBinsByStation(updatedBins17, [{ id: 'station_a_id', code: 'STATION_A', name: 'Trạm A' }], now17);
  const stationAGroup = groups17.find((g) => g.code === 'STATION_A')!;
  assert.strictEqual(stationAGroup.averageFillPct, 44, 'Trung bình mức đầy Trạm A phải là 44% (khớp hoàn toàn với các thẻ 67% và 21%)');
  assert.strictEqual(stationAGroup.status, 'ONLINE');
  console.log('  -> PASS: HC1=67%, HC2=21%, HC3=—; Trung bình mức đầy = 44%; Không bị biến null thành 0%; Đồng bộ hoàn hảo giữa Header và Cards\n');

  // Test 18: Exact Production Evidence Scenario (HC1=36%, HC2=14%, HC3=3%, delayOnPiMs=11s + 5s heartbeat interval + Browser Clock Skew)
  console.log('Test 18: Exact Production Evidence (HC1=36% RECYCLABLE, HC2=14% NON_RECYCLABLE, HC3=3% ORGANIC, Header=18%, Cards never show "—")');
  const serverNow18 = Date.now();
  const browserNow18 = serverNow18 + 22000; // Đồng hồ PC người dùng chạy nhanh hơn Server 22s
  const prodHeartbeat36_14_3 = {
    stationCode: 'STATION_A',
    deviceId: 'raspberry-pi-5',
    status: 'ONLINE',
    // Trên Pi, cảm biến đo cách thời điểm sentAt 11 giây (vẫn hợp lệ <= 15s theo HC_VALID_TIMEOUT_SEC)
    sentAt: new Date(serverNow18).toISOString(),
    receivedAt: new Date(serverNow18).toISOString(),
    lastHeartbeat: new Date(serverNow18).toISOString(),
    subsystems: {
      yolo: 'RUNNING',
      camera: 'CONNECTED'
    },
    sensors: {
      recyclable: {
        fillLevel: 36,
        distanceCm: 38.4,
        status: 'OK',
        updatedAt: new Date(serverNow18 - 11000).toISOString()
      },
      nonRecyclable: {
        fillLevel: 14,
        distanceCm: 51.6,
        status: 'OK',
        updatedAt: new Date(serverNow18 - 11000).toISOString()
      },
      organic: {
        fillLevel: 3,
        distanceCm: 58.2,
        status: 'OK',
        updatedAt: new Date(serverNow18 - 11000).toISOString()
      }
    }
  };

  // Trình duyệt nhận sự kiện tại thời điểm browserNow18 và kiểm tra sau 4.5s (trước nhịp heartbeat 5s tiếp theo)
  const mergedProdBins = mergeDeviceHeartbeatToBins(initialBins, prodHeartbeat36_14_3, browserNow18);
  const checkTimeAfter4_5s = browserNow18 + 4500;
  const prodGroups = groupBinsByStation(mergedProdBins, DEFAULT_STATION_CONFIG, checkTimeAfter4_5s);
  const prodStationA = prodGroups.find((g) => g.code === 'STATION_A')!;
  const prodStationB = prodGroups.find((g) => g.code === 'STATION_B')!;

  const prodRecCard = computeBinViewModel(
    prodStationA.compartments.find((c) => c.key === 'RECYCLABLE')!.bin,
    checkTimeAfter4_5s
  );
  const prodNonRecCard = computeBinViewModel(
    prodStationA.compartments.find((c) => c.key === 'NON_RECYCLABLE')!.bin,
    checkTimeAfter4_5s
  );
  const prodOrgCard = computeBinViewModel(
    prodStationA.compartments.find((c) => c.key === 'ORGANIC')!.bin,
    checkTimeAfter4_5s
  );

  // Kiểm tra chính xác từng thẻ ngăn rác (HC1 -> RECYCLABLE=36%, HC2 -> NON_RECYCLABLE=14%, HC3 -> ORGANIC=3%)
  assert.strictEqual(prodRecCard.isValidReading, true, 'RECYCLABLE card must be valid (not falsely STALE)');
  assert.strictEqual(prodRecCard.displayPercentage, '36%', 'HC1 -> RECYCLABLE must display 36%');
  assert.strictEqual(prodRecCard.progressWidth, '36%');

  assert.strictEqual(prodNonRecCard.isValidReading, true, 'NON_RECYCLABLE card must be valid (not falsely STALE)');
  assert.strictEqual(prodNonRecCard.displayPercentage, '14%', 'HC2 -> NON_RECYCLABLE must display 14%');
  assert.strictEqual(prodNonRecCard.progressWidth, '14%');

  assert.strictEqual(prodOrgCard.isValidReading, true, 'ORGANIC card must be valid (not falsely STALE)');
  assert.strictEqual(prodOrgCard.displayPercentage, '3%', 'HC3 -> ORGANIC must display 3%');
  assert.strictEqual(prodOrgCard.progressWidth, '3%');

  // Kiểm tra Header Trạm A: Math.round((36 + 14 + 3) / 3) = Math.round(17.666...) = 18%
  assert.strictEqual(prodStationA.averageFillPct, 18, 'Station A header average must be Math.round((36+14+3)/3) = 18%');
  assert.strictEqual(prodStationA.status, 'ONLINE');

  // Kiểm tra cách ly Trạm B: Trạm B RECYCLABLE không bị ảnh hưởng bởi HC1=36% của Trạm A
  const prodStationBRec = computeBinViewModel(
    prodStationB.compartments.find((c) => c.key === 'RECYCLABLE')!.bin,
    checkTimeAfter4_5s
  );
  assert.strictEqual(prodStationBRec.displayPercentage, '—', 'Station B RECYCLABLE must remain isolated from Station A');
  console.log('  -> PASS: HC1=36% (RECYCLABLE), HC2=14% (NON_RECYCLABLE), HC3=3% (ORGANIC), Header=18%, hoàn toàn miễn nhiễm lệch đồng hồ & delayOnPiMs\n');

  // Test 19: Partial Socket.IO sensor update does NOT erase other valid Bin readings, and REST refresh does NOT overwrite newer realtime values
  console.log('Test 19: Partial Socket.IO update preserves other valid Bins & REST refresh preserves newer realtime state');
  const partialSocketUpdate = {
    stationCode: 'STATION_A',
    deviceId: 'raspberry-pi-5',
    status: 'ONLINE',
    sentAt: new Date(serverNow18 + 2000).toISOString(),
    receivedAt: new Date(serverNow18 + 2000).toISOString(),
    lastHeartbeat: new Date(serverNow18 + 2000).toISOString(),
    sensors: {
      // Chỉ cập nhật HC1 (RECYCLABLE = 40%), không truyền nonRecyclable và organic
      recyclable: {
        fillLevel: 40,
        distanceCm: 36.0,
        status: 'OK',
        updatedAt: new Date(serverNow18 + 2000).toISOString()
      }
    }
  };

  const afterPartialSocket = mergeDeviceHeartbeatToBins(mergedProdBins, partialSocketUpdate, browserNow18 + 2000);
  const recAfterPartial = afterPartialSocket.find((b) => b.binCode === 'RECYCLABLE' && !b.stationId)!;
  const nonRecAfterPartial = afterPartialSocket.find((b) => b.binCode === 'NON_RECYCLABLE' && !b.stationId)!;
  const orgAfterPartial = afterPartialSocket.find((b) => b.binCode === 'ORGANIC' && !b.stationId)!;

  assert.strictEqual(recAfterPartial.currentFillLevel, 40, 'RECYCLABLE updated to 40%');
  assert.strictEqual(nonRecAfterPartial.currentFillLevel, 14, 'NON_RECYCLABLE 14% preserved when omitted from partial update');
  assert.strictEqual(orgAfterPartial.currentFillLevel, 3, 'ORGANIC 3% preserved when omitted from partial update');

  // Mô phỏng phản hồi REST /api/dashboard/summary đến muộn (chứa dữ liệu cũ hơn từ thời điểm serverNow18 - 5000 hoặc null)
  const staleRestBins = [
    { ...initialBins[0], currentFillLevel: 10, status: 'ONLINE' as const, lastSeen: new Date(serverNow18 - 5000).toISOString() },
    { ...initialBins[1], currentFillLevel: null, status: 'OFFLINE' as const, lastSeen: new Date(serverNow18 - 5000).toISOString() },
    { ...initialBins[2], currentFillLevel: null, status: 'OFFLINE' as const, lastSeen: new Date(serverNow18 - 5000).toISOString() }
  ];
  const afterRestRefresh = mergeRestBinsWithRealtimeState(afterPartialSocket, staleRestBins as any, browserNow18 + 3000);
  assert.strictEqual(afterRestRefresh.find((b) => b.binCode === 'RECYCLABLE')!.currentFillLevel, 40, 'REST refresh must NOT overwrite newer 40% realtime value');
  assert.strictEqual(afterRestRefresh.find((b) => b.binCode === 'NON_RECYCLABLE')!.currentFillLevel, 14, 'REST refresh must NOT overwrite newer 14% realtime value');
  assert.strictEqual(afterRestRefresh.find((b) => b.binCode === 'ORGANIC')!.currentFillLevel, 3, 'REST refresh must NOT overwrite newer 3% realtime value');
  console.log('  -> PASS: Partial Socket.IO update và REST refresh bảo toàn tuyệt đối các giá trị cảm biến hợp lệ\n');

  console.log('================================================================');
  console.log('  ALL 19 END-TO-END FRONTEND TELEMETRY TESTS PASSED CLEANLY (19/19)!');
  console.log('================================================================\n');
}

runFrontendEndToEndTests();

