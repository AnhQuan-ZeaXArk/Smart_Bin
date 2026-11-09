import assert from 'node:assert/strict';
import type { Bin } from './bins';
import {
  computeBinViewModel,
  groupBinsByStation,
  ensureStationList,
  mergeDeviceHeartbeatToBins
} from './bin-view-model';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== RUNNING ROUND 22 MULTI-STATION DASHBOARD TEST SUITE (T1 - T9) ===\n');

// Mock Data Setup
const mockBinsStationA: (Bin & { distanceCm: number | null })[] = [
  {
    id: 'bin-a-organic',
    binCode: 'ORGANIC',
    name: 'Rác hữu cơ',
    location: 'Ngăn rác hữu cơ Trạm A',
    latitude: null,
    longitude: null,
    capacity: 240,
    currentFillLevel: 25,
    distanceCm: 75,
    fillCategory: 'NORMAL',
    status: 'ONLINE',
    isActive: true,
    installed: true,
    lastSeen: new Date().toISOString(),
    createdAt: '',
    updatedAt: '',
    stationId: 'station_a_canonical_id',
    stationCode: 'STATION_A',
    station: { id: 'station_a_canonical_id', code: 'STATION_A', name: 'Trạm Thu gom Trung tâm A' }
  },
  {
    id: 'bin-a-recyclable',
    binCode: 'RECYCLABLE',
    name: 'Rác tái chế',
    location: 'Ngăn rác tái chế Trạm A',
    latitude: null,
    longitude: null,
    capacity: 240,
    currentFillLevel: 58,
    distanceCm: 42,
    fillCategory: 'MONITOR',
    status: 'ONLINE',
    isActive: true,
    installed: true,
    lastSeen: new Date().toISOString(),
    createdAt: '',
    updatedAt: '',
    stationId: 'station_a_canonical_id',
    stationCode: 'STATION_A',
    station: { id: 'station_a_canonical_id', code: 'STATION_A', name: 'Trạm Thu gom Trung tâm A' }
  },
  {
    id: 'bin-a-non-recyclable',
    binCode: 'NON_RECYCLABLE',
    name: 'Rác không tái chế',
    location: 'Ngăn rác không tái chế Trạm A',
    latitude: null,
    longitude: null,
    capacity: 360,
    currentFillLevel: 78,
    distanceCm: 22,
    fillCategory: 'NEARLY_FULL',
    status: 'ONLINE',
    isActive: true,
    installed: true,
    lastSeen: new Date().toISOString(),
    createdAt: '',
    updatedAt: '',
    stationId: 'station_a_canonical_id',
    stationCode: 'STATION_A',
    station: { id: 'station_a_canonical_id', code: 'STATION_A', name: 'Trạm Thu gom Trung tâm A' }
  }
];

function runTests() {
  // --------------------------------------------------------------------------
  // Test T1: API chỉ trả Station A -> Dashboard vẫn hiển thị A và B
  // --------------------------------------------------------------------------
  console.log('T1: API chỉ trả Station A -> Dashboard vẫn hiển thị A và B');
  const apiStationsOnlyA = [
    {
      id: 'station_a_canonical_id',
      code: 'STATION_A',
      name: 'Trạm Thu gom Trung tâm A',
      status: 'ONLINE',
      isActive: true,
      location: 'Khuôn viên chính'
    }
  ];

  const resolvedStations = ensureStationList(apiStationsOnlyA);
  assert.equal(resolvedStations.length, 2, 'ensureStationList must append Station B fallback');
  assert.equal(resolvedStations[0].code, 'STATION_A');
  assert.equal(resolvedStations[1].code, 'STATION_B');

  const groupsFromOnlyA = groupBinsByStation(mockBinsStationA, apiStationsOnlyA);
  assert.equal(groupsFromOnlyA.length, 2, 'Must render both Station A and B even if API only returns Station A');
  const stA1 = groupsFromOnlyA.find((g) => g.code === 'STATION_A');
  const stB1 = groupsFromOnlyA.find((g) => g.code === 'STATION_B');
  assert.ok(stA1, 'Station A must exist');
  assert.ok(stB1, 'Station B must exist');
  assert.equal(stA1!.status, 'ONLINE');
  assert.equal(stB1!.status, 'OFFLINE');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T2: API trả cả A và B -> Dashboard chỉ hiển thị mỗi trạm một lần (Deduplication)
  // --------------------------------------------------------------------------
  console.log('T2: API trả cả A và B -> Dashboard chỉ hiển thị mỗi trạm một lần');
  const apiStationsBoth = [
    {
      id: 'station_a_canonical_id',
      code: 'STATION_A',
      name: 'Trạm Thu gom Trung tâm A',
      status: 'ONLINE',
      isActive: true,
      location: 'Khuôn viên chính'
    },
    {
      id: 'station_b_canonical_id',
      code: 'STATION_B',
      name: 'Trạm Thu gom Trung tâm B',
      status: 'OFFLINE',
      isActive: true,
      location: 'Khuôn viên phía Đông'
    }
  ];

  const resolvedBoth = ensureStationList(apiStationsBoth);
  assert.equal(resolvedBoth.length, 2, 'Must not duplicate Station B when API already returns it');
  assert.equal(resolvedBoth.filter((s) => s.code === 'STATION_B').length, 1);

  const groupsBoth = groupBinsByStation(mockBinsStationA, apiStationsBoth);
  assert.equal(groupsBoth.length, 2, 'Each station rendered exactly once');
  assert.equal(groupsBoth.filter((g) => g.code === 'STATION_A').length, 1);
  assert.equal(groupsBoth.filter((g) => g.code === 'STATION_B').length, 1);
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T3: Station B chưa có telemetry -> Recyclable hiển thị —, không phải 0%
  // --------------------------------------------------------------------------
  console.log('T3: Station B chưa có telemetry -> Recyclable hiển thị —, không phải 0%');
  const compRec = stB1!.compartments.find((c) => c.key === 'RECYCLABLE');
  assert.ok(compRec?.bin, 'Station B RECYCLABLE bin must exist');
  assert.equal(compRec!.bin!.installed, true, 'RECYCLABLE must be installed: true');
  assert.equal(compRec!.bin!.currentFillLevel, null, 'Must NOT have fake telemetry');
  assert.equal(compRec!.bin!.status, 'OFFLINE');

  const vmRec = computeBinViewModel(compRec!.bin);
  assert.equal(vmRec.hasValidFillLevel, false, 'hasValidFillLevel must be false');
  assert.equal(vmRec.isValidReading, false, 'isValidReading must be false');
  assert.equal(vmRec.displayPercentage, '—', 'Must display "—" placeholder');
  assert.notEqual(vmRec.displayPercentage, '0%', 'Must NEVER display "0%" for missing telemetry');
  assert.equal(vmRec.statusBadgeText, 'Mất kết nối');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T4: Hai Bin chưa lắp đặt hiển thị đúng nhãn ("Chưa lắp đặt")
  // --------------------------------------------------------------------------
  console.log('T4: Hai Bin chưa lắp đặt hiển thị đúng nhãn ("Chưa lắp đặt")');
  const compOrg = stB1!.compartments.find((c) => c.key === 'ORGANIC');
  const compNon = stB1!.compartments.find((c) => c.key === 'NON_RECYCLABLE');
  assert.ok(compOrg?.bin, 'ORGANIC bin must exist');
  assert.ok(compNon?.bin, 'NON_RECYCLABLE bin must exist');
  assert.equal(compOrg!.bin!.installed, false, 'ORGANIC must be marked installed: false');
  assert.equal(compNon!.bin!.installed, false, 'NON_RECYCLABLE must be marked installed: false');

  const vmOrg = computeBinViewModel(compOrg!.bin);
  const vmNon = computeBinViewModel(compNon!.bin);

  assert.equal(vmOrg.isUninstalled, true);
  assert.equal(vmOrg.statusBadgeText, 'Chưa lắp đặt');
  assert.equal(vmOrg.fillCategoryBadgeText, 'Chưa lắp đặt');
  assert.equal(vmOrg.displayPercentage, '—');
  assert.equal(vmOrg.isOffline, false, 'Uninstalled bin must NOT be marked isOffline');

  assert.equal(vmNon.isUninstalled, true);
  assert.equal(vmNon.statusBadgeText, 'Chưa lắp đặt');
  assert.equal(vmNon.fillCategoryBadgeText, 'Chưa lắp đặt');
  assert.equal(vmNon.displayPercentage, '—');
  assert.equal(vmNon.isOffline, false, 'Uninstalled bin must NOT be marked isOffline');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T5: Station A không bị ảnh hưởng
  // --------------------------------------------------------------------------
  console.log('T5: Station A không bị ảnh hưởng');
  assert.equal(stA1!.installedCount, 3, 'Station A has 3 installed bins');
  assert.equal(stA1!.totalBinsCount, 3);
  assert.equal(stA1!.status, 'ONLINE');

  const compAOrg = stA1!.compartments.find((c) => c.key === 'ORGANIC');
  const compARec = stA1!.compartments.find((c) => c.key === 'RECYCLABLE');
  const compANon = stA1!.compartments.find((c) => c.key === 'NON_RECYCLABLE');

  assert.equal(compAOrg!.bin!.currentFillLevel, 25);
  assert.equal(compARec!.bin!.currentFillLevel, 58);
  assert.equal(compANon!.bin!.currentFillLevel, 78);

  const vmAOrg = computeBinViewModel(compAOrg!.bin);
  assert.equal(vmAOrg.displayPercentage, '25%');
  assert.equal(vmAOrg.isValidReading, true);
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T6: Station B nhận telemetry thật -> cập nhật mức đầy chính xác
  // --------------------------------------------------------------------------
  console.log('T6: Station B nhận telemetry thật -> cập nhật mức đầy chính xác');
  const hbLive = {
    stationCode: 'STATION_B',
    status: 'ONLINE',
    lastHeartbeat: new Date().toISOString(),
    sensors: {
      recyclable: {
        fillLevel: 68.4,
        distanceCm: 15.8,
        status: 'ONLINE',
        updatedAt: new Date().toISOString()
      }
    }
  };

  const mergedWithHeartbeat = mergeDeviceHeartbeatToBins(mockBinsStationA, hbLive);
  const groupsWithHeartbeat = groupBinsByStation(mergedWithHeartbeat, apiStationsOnlyA);
  const stBLive = groupsWithHeartbeat.find((g) => g.code === 'STATION_B')!;
  const compRecLive = stBLive.compartments.find((c) => c.key === 'RECYCLABLE')!;

  assert.equal(compRecLive.bin!.status, 'ONLINE');
  assert.equal(compRecLive.bin!.currentFillLevel, 68.4);
  assert.equal(compRecLive.bin!.distanceCm, 15.8);

  const vmRecLive = computeBinViewModel(compRecLive.bin);
  assert.equal(vmRecLive.isValidReading, true);
  assert.equal(vmRecLive.displayPercentage, '68%');
  assert.equal(vmRecLive.statusBadgeText, 'Trực tuyến');
  assert.equal(stBLive.status, 'ONLINE');
  assert.equal(stBLive.averageFillPct, 68);

  // Verify Station A is completely unchanged
  const stALive = groupsWithHeartbeat.find((g) => g.code === 'STATION_A')!;
  assert.equal(stALive.compartments.find((c) => c.key === 'RECYCLABLE')!.bin!.currentFillLevel, 58);
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T7: Mất kết nối Station B -> chỉ Station B chuyển OFFLINE
  // --------------------------------------------------------------------------
  console.log('T7: Mất kết nối Station B -> chỉ Station B chuyển OFFLINE');
  const hbOffline = {
    stationCode: 'STATION_B',
    status: 'OFFLINE',
    lastHeartbeat: new Date().toISOString()
  };

  const mergedAfterOffline = mergeDeviceHeartbeatToBins(mergedWithHeartbeat, hbOffline);
  const groupsAfterOffline = groupBinsByStation(mergedAfterOffline, apiStationsOnlyA);
  const stBOff = groupsAfterOffline.find((g) => g.code === 'STATION_B')!;
  const compRecOff = stBOff.compartments.find((c) => c.key === 'RECYCLABLE')!;

  assert.equal(stBOff.status, 'OFFLINE', 'Station B must be OFFLINE');
  assert.equal(compRecOff.bin!.status, 'OFFLINE');
  assert.equal(compRecOff.bin!.currentFillLevel, null, 'Fill level nullified on disconnect');

  const vmRecOff = computeBinViewModel(compRecOff.bin);
  assert.equal(vmRecOff.isValidReading, false);
  assert.equal(vmRecOff.displayPercentage, '—');

  // Station A remains ONLINE and undisturbed
  const stAOff = groupsAfterOffline.find((g) => g.code === 'STATION_A')!;
  assert.equal(stAOff.status, 'ONLINE', 'Station A must remain ONLINE');
  assert.equal(stAOff.compartments.find((c) => c.key === 'ORGANIC')!.bin!.status, 'ONLINE');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T8: Mobile responsive (kiểm tra CSS và layout structure)
  // --------------------------------------------------------------------------
  console.log('T8: Mobile responsive (kiểm tra CSS và layout structure)');
  const dashboardSource = fs.readFileSync(path.resolve('apps/web/src/dashboard.tsx'), 'utf-8');
  const appCssSource = fs.readFileSync(path.resolve('apps/web/src/App.css'), 'utf-8');

  assert.ok(dashboardSource.includes('stations-container'), 'dashboard.tsx must use .stations-container');
  assert.ok(dashboardSource.includes('station-section'), 'dashboard.tsx must use .station-section');
  assert.ok(dashboardSource.includes('waste-grid'), 'dashboard.tsx must use .waste-grid');
  assert.ok(dashboardSource.includes('station-header'), 'dashboard.tsx must use .station-header');

  assert.ok(appCssSource.includes('@media'), 'App.css must have responsive media queries');
  assert.ok(appCssSource.includes('stations-container') || appCssSource.includes('waste-grid'), 'App.css must style multi-station containers');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T9: KPI không tính nhầm Bin chưa lắp đặt
  // --------------------------------------------------------------------------
  console.log('T9: KPI không tính nhầm Bin chưa lắp đặt');
  const allInstalled = groupsFromOnlyA.flatMap((g) =>
    g.compartments.filter((c) => c.bin && c.bin.installed !== false).map((c) => c.bin!)
  );

  const totalStations = groupsFromOnlyA.length;
  const totalInstalled = allInstalled.length;
  const onlineStations = groupsFromOnlyA.filter((g) => g.status === 'ONLINE').length;
  const offlineBins = allInstalled.filter((b) => {
    const vm = computeBinViewModel(b);
    return !vm.isValidReading || b.status === 'OFFLINE';
  }).length;

  assert.equal(totalStations, 2, 'Total stations must be 2');
  assert.equal(totalInstalled, 4, 'Total installed bins must be exactly 4 (3 for A + 1 for B)');
  assert.equal(onlineStations, 1, 'Only Station A is ONLINE (1/2 online)');
  assert.equal(offlineBins, 1, 'Only Station B RECYCLABLE is offline; uninstalled bins excluded');
  console.log('  -> PASS');

  console.log('\n=== ALL 9 ROUND 22 MANDATORY TESTS (T1 - T9) PASSED CLEANLY! ===\n');
}

runTests();
