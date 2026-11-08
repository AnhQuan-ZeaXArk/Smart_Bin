import assert from 'node:assert/strict';
import type { Bin } from './bins';
import {
  computeBinViewModel,
  groupBinsByStation,
  DEFAULT_STATION_CONFIG
} from './bin-view-model';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== RUNNING ROUND 19.1 MULTI-STATION DASHBOARD REFINEMENT TESTS (T1 - T9) ===\n');

// 1. Mock Data Setup
const mockStations = DEFAULT_STATION_CONFIG;

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
  // Test T1: Dashboard displays both Station A and B when two stations are configured
  // --------------------------------------------------------------------------
  console.log('T1: Dashboard hiển thị cả Station A và B khi có cấu hình hai trạm');
  const groupsConfigured = groupBinsByStation(mockBinsStationA, mockStations);
  assert.equal(groupsConfigured.length, 2, 'Must have exactly 2 stations');
  const stA = groupsConfigured.find(g => g.code === 'STATION_A');
  const stB = groupsConfigured.find(g => g.code === 'STATION_B');
  assert.ok(stA, 'Station A must be present');
  assert.ok(stB, 'Station B must be present');
  assert.equal(stA!.name, 'Trạm Thu gom Trung tâm A');
  assert.equal(stB!.name, 'Trạm Thu gom Mở rộng B');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T2: Station B is displayed even when it has NO telemetry
  // --------------------------------------------------------------------------
  console.log('T2: Station B vẫn hiển thị khi chưa có telemetry từ Backend');
  // Pass only Station A bins; Station B has 0 bins in the input array
  assert.ok(stB, 'Station B must exist even with zero incoming telemetry');
  assert.equal(stB!.compartments.length, 3, 'Station B must still render 3 compartments');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T3: Station B has exactly 1 bin INSTALLED and 2 bins NOT_INSTALLED
  // --------------------------------------------------------------------------
  console.log('T3: Station B có chính xác 1 bin INSTALLED và 2 bin NOT_INSTALLED');
  assert.equal(stB!.installedCount, 1, 'Station B must report exactly 1 installed bin');
  assert.equal(stB!.totalBinsCount, 3, 'Station B total compartments must be 3');

  const compRec = stB!.compartments.find(c => c.key === 'RECYCLABLE');
  const compOrg = stB!.compartments.find(c => c.key === 'ORGANIC');
  const compNon = stB!.compartments.find(c => c.key === 'NON_RECYCLABLE');

  assert.ok(compRec?.bin, 'RECYCLABLE compartment must exist');
  assert.equal(compRec!.bin!.installed, true, 'RECYCLABLE must be marked installed: true');
  assert.equal(compRec!.bin!.status, 'OFFLINE', 'Without telemetry, installed bin must be OFFLINE');
  assert.equal(compRec!.bin!.currentFillLevel, null, 'Must NOT have fake telemetry');

  assert.ok(compOrg?.bin, 'ORGANIC compartment must exist');
  assert.equal(compOrg!.bin!.installed, false, 'ORGANIC must be NOT_INSTALLED (installed: false)');

  assert.ok(compNon?.bin, 'NON_RECYCLABLE compartment must exist');
  assert.equal(compNon!.bin!.installed, false, 'NON_RECYCLABLE must be NOT_INSTALLED (installed: false)');

  const vmOrg = computeBinViewModel(compOrg!.bin);
  assert.equal(vmOrg.isUninstalled, true);
  assert.equal(vmOrg.isOffline, false, 'NOT_INSTALLED bin must NOT be marked isOffline');
  assert.equal(vmOrg.statusBadgeText, 'Chưa lắp đặt');
  assert.equal(vmOrg.displayPercentage, '—');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T4: KPI calculation across 2 stations and 4 installed bins
  // --------------------------------------------------------------------------
  console.log('T4: KPI tính tổng 2 trạm và 4 thùng đã lắp');
  const allInstalled = groupsConfigured.flatMap(g =>
    g.compartments.filter(c => c.bin && c.bin.installed !== false).map(c => c.bin!)
  );

  const totalStations = groupsConfigured.length;
  const totalInstalled = allInstalled.length;
  const onlineStations = groupsConfigured.filter(g => g.status === 'ONLINE').length;
  const offlineBins = allInstalled.filter(b => {
    const vm = computeBinViewModel(b);
    return !vm.isValidReading || b.status === 'OFFLINE';
  }).length;

  assert.equal(totalStations, 2, 'Total stations must be 2');
  assert.equal(totalInstalled, 4, 'Total installed bins must be exactly 4 (3 for A + 1 for B)');
  assert.equal(onlineStations, 1, 'Station A is ONLINE, Station B is OFFLINE (1 station ONLINE)');
  assert.equal(offlineBins, 1, 'Only Station B RECYCLABLE is offline (NOT_INSTALLED bins are excluded)');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T5: Filter by Station A / Station B
  // --------------------------------------------------------------------------
  console.log('T5: Bộ lọc Station A/B hoạt động');
  const filterAll = groupsConfigured.filter(() => true);
  assert.equal(filterAll.length, 2);

  const filterA = groupsConfigured.filter(g => g.code === 'STATION_A');
  assert.equal(filterA.length, 1);
  assert.equal(filterA[0].installedCount, 3);

  const filterB = groupsConfigured.filter(g => g.code === 'STATION_B');
  assert.equal(filterB.length, 1);
  assert.equal(filterB[0].installedCount, 1);
  assert.equal(filterB[0].compartments.length, 3);
  assert.equal(filterB[0].compartments.filter(c => c.bin?.installed === false).length, 2);
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T6: Station header has NO location, Gateway, or Controller
  // --------------------------------------------------------------------------
  console.log('T6: Header không còn vị trí, Gateway, Controller');
  const dashboardSource = fs.readFileSync(path.resolve('apps/web/src/dashboard.tsx'), 'utf-8');
  assert.ok(!dashboardSource.includes('station-meta-row'), 'dashboard.tsx must not contain .station-meta-row');
  assert.ok(!dashboardSource.includes('group.gatewayInfo'), 'dashboard.tsx must not render group.gatewayInfo');
  assert.ok(!dashboardSource.includes('group.controllerInfo'), 'dashboard.tsx must not render group.controllerInfo');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T7: Device status has NO 3-compartment fill level section
  // --------------------------------------------------------------------------
  console.log('T7: Device status không còn section mức đầy ba ngăn rác');
  const realDeviceSource = fs.readFileSync(path.resolve('apps/web/src/real-device-card.tsx'), 'utf-8');
  assert.ok(!realDeviceSource.includes('real-compartments-section'), 'real-device-card must not have real-compartments-section');
  assert.ok(!realDeviceSource.includes('Mức Đầy 3 Ngăn Rác Thực Tế'), 'real-device-card must not have text "Mức Đầy 3 Ngăn Rác Thực Tế"');
  assert.ok(!realDeviceSource.includes('renderCompartmentCard'), 'real-device-card must not have renderCompartmentCard');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T8: Raspberry Pi telemetry and heartbeat fields remain functional
  // --------------------------------------------------------------------------
  console.log('T8: Các thông tin heartbeat và telemetry của Raspberry Pi vẫn hoạt động');
  assert.ok(realDeviceSource.includes('Trạng thái kết nối'), 'Must retain connection status card');
  assert.ok(realDeviceSource.includes('Heartbeat gần nhất'), 'Must retain last heartbeat card');
  assert.ok(realDeviceSource.includes('Thời gian hoạt động (Uptime)'), 'Must retain uptime card');
  assert.ok(realDeviceSource.includes('Tổng gói Telemetry'), 'Must retain telemetry packet count card');
  assert.ok(realDeviceSource.includes('Nhiệt độ CPU Pi 5'), 'Must retain CPU temperature card');
  assert.ok(realDeviceSource.includes('Kênh kết nối Pi 5'), 'Must retain connection channel card');
  console.log('  -> PASS');

  // --------------------------------------------------------------------------
  // Test T9: No regression with legacy single-station data
  // --------------------------------------------------------------------------
  console.log('T9: Không phát sinh regression với Dashboard cũ');
  const legacyBins: (Bin & { distanceCm: number | null })[] = [
    {
      id: 'legacy-1',
      binCode: 'ORGANIC',
      name: 'Rác hữu cơ cũ',
      location: 'Ngăn rác hữu cơ',
      latitude: null,
      longitude: null,
      capacity: 240,
      currentFillLevel: 30,
      distanceCm: 70,
      fillCategory: 'NORMAL',
      status: 'ONLINE',
      isActive: true,
      lastSeen: new Date().toISOString(),
      createdAt: '',
      updatedAt: ''
    }
  ];
  // When an explicit single station legacy configuration is supplied:
  const singleStationLegacyConfig = [{ id: 'station_a_canonical_id', code: 'STATION_A', name: 'Trạm Thu gom Trung tâm A', status: 'ONLINE', location: null }];
  const groupsSingleLegacy = groupBinsByStation(legacyBins, singleStationLegacyConfig);
  assert.equal(groupsSingleLegacy.length, 1);
  assert.equal(groupsSingleLegacy[0].code, 'STATION_A');
  assert.equal(groupsSingleLegacy[0].installedCount, 1);
  console.log('  -> PASS');

  console.log('\n=== ALL 9 REFINEMENT TESTS (T1 - T9) PASSED CLEANLY! ===\n');
}

runTests();
