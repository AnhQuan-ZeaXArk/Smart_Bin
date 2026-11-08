import assert from 'node:assert/strict';
import type { Bin } from './bins';
import {
  computeBinViewModel,
  groupBinsByStation
} from './bin-view-model';

console.log('=== RUNNING MULTI-STATION DASHBOARD UI TESTS (MS-1 to MS-8) ===\n');

// 1. Mock Data Setup
const mockStations = [
  {
    id: 'station_a_canonical_id',
    code: 'STATION_A',
    name: 'Trạm Thu gom Trung tâm A',
    status: 'ONLINE',
    location: 'Khuôn viên chính'
  },
  {
    id: 'station_b_canonical_id',
    code: 'STATION_B',
    name: 'Trạm Thu gom Mở rộng B',
    status: 'OFFLINE',
    location: 'Khuôn viên phía Đông'
  }
];

const mockBins: (Bin & { distanceCm: number | null })[] = [
  // Station A bins (All 3 installed)
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
  },
  // Station B bins (1 installed, 2 uninstalled)
  {
    id: 'bin-b-recyclable',
    binCode: 'RECYCLABLE',
    name: 'Rác tái chế Trạm B',
    location: 'Ngăn rác tái chế Trạm B',
    latitude: null,
    longitude: null,
    capacity: 240,
    currentFillLevel: 10,
    distanceCm: 80,
    fillCategory: 'NORMAL',
    status: 'ONLINE',
    isActive: true,
    installed: true,
    lastSeen: new Date().toISOString(),
    createdAt: '',
    updatedAt: '',
    stationId: 'station_b_canonical_id',
    stationCode: 'STATION_B',
    station: { id: 'station_b_canonical_id', code: 'STATION_B', name: 'Trạm Thu gom Mở rộng B' }
  },
  {
    id: 'bin-b-organic',
    binCode: 'ORGANIC',
    name: 'Rác hữu cơ Trạm B',
    location: 'Ngăn rác hữu cơ Trạm B',
    latitude: null,
    longitude: null,
    capacity: 240,
    currentFillLevel: null,
    distanceCm: null,
    fillCategory: 'NORMAL',
    status: 'MAINTENANCE',
    isActive: false,
    installed: false, // NOT_INSTALLED
    lastSeen: null,
    createdAt: '',
    updatedAt: '',
    stationId: 'station_b_canonical_id',
    stationCode: 'STATION_B',
    station: { id: 'station_b_canonical_id', code: 'STATION_B', name: 'Trạm Thu gom Mở rộng B' }
  },
  {
    id: 'bin-b-non-recyclable',
    binCode: 'NON_RECYCLABLE',
    name: 'Rác không tái chế Trạm B',
    location: 'Ngăn rác không tái chế Trạm B',
    latitude: null,
    longitude: null,
    capacity: 360,
    currentFillLevel: null,
    distanceCm: null,
    fillCategory: 'NORMAL',
    status: 'MAINTENANCE',
    isActive: false,
    installed: false, // NOT_INSTALLED
    lastSeen: null,
    createdAt: '',
    updatedAt: '',
    stationId: 'station_b_canonical_id',
    stationCode: 'STATION_B',
    station: { id: 'station_b_canonical_id', code: 'STATION_B', name: 'Trạm Thu gom Mở rộng B' }
  }
];

function runTests() {
  const groups = groupBinsByStation(mockBins, mockStations);

  // Test MS-1: Station grouping count
  console.log('MS-1: Grouping produces 2 stations (Station A and Station B)');
  assert.equal(groups.length, 2);
  const stA = groups.find(g => g.code === 'STATION_A');
  const stB = groups.find(g => g.code === 'STATION_B');
  assert.ok(stA, 'Station A must exist in groups');
  assert.ok(stB, 'Station B must exist in groups');
  console.log('  -> PASS');

  // Test MS-2: Station A has 3 installed bins
  console.log('MS-2: Station A has 3 installed bins with correct hardware metadata');
  assert.equal(stA!.installedCount, 3);
  assert.equal(stA!.totalBinsCount, 3);
  assert.equal(stA!.gatewayInfo, 'Raspberry Pi 5');
  assert.equal(stA!.controllerInfo, 'ESP32 A');
  assert.equal(stA!.compartments.length, 3);
  for (const c of stA!.compartments) {
    assert.ok(c.bin, `Station A compartment ${c.key} must have a bin`);
    assert.equal(c.bin!.installed, true, `Station A bin ${c.key} must be installed`);
  }
  console.log('  -> PASS');

  // Test MS-3: Station B has 1 installed bin and 2 uninstalled bins
  console.log('MS-3: Station B has 1 installed bin and 2 uninstalled bins');
  assert.equal(stB!.installedCount, 1);
  assert.equal(stB!.totalBinsCount, 3);
  assert.equal(stB!.gatewayInfo, 'Raspberry Pi 5 (Dùng chung)');
  assert.equal(stB!.controllerInfo, 'ESP32-C6');
  assert.equal(stB!.compartments.length, 3);

  const compRecyclable = stB!.compartments.find(c => c.key === 'RECYCLABLE');
  const compOrganic = stB!.compartments.find(c => c.key === 'ORGANIC');
  const compNonRecyclable = stB!.compartments.find(c => c.key === 'NON_RECYCLABLE');

  assert.ok(compRecyclable && compRecyclable.bin, 'Station B must have Recyclable compartment');
  assert.equal(compRecyclable.bin!.installed, true, 'Recyclable must be installed');

  assert.ok(compOrganic && compOrganic.bin, 'Station B must have Organic compartment');
  assert.equal(compOrganic.bin!.installed, false, 'Organic must be NOT_INSTALLED');

  assert.ok(compNonRecyclable && compNonRecyclable.bin, 'Station B must have Non-Recyclable compartment');
  assert.equal(compNonRecyclable.bin!.installed, false, 'Non-Recyclable must be NOT_INSTALLED');
  console.log('  -> PASS');

  // Test MS-4: Uninstalled bins compute correct view model
  console.log('MS-4: Uninstalled bins are NOT counted as OFFLINE and show "Chưa lắp đặt"');
  const vmUninstalled = computeBinViewModel(compOrganic!.bin);
  assert.equal(vmUninstalled.isUninstalled, true);
  assert.equal(vmUninstalled.isOffline, false, 'Uninstalled bin must NOT be marked isOffline');
  assert.equal(vmUninstalled.statusBadgeText, 'Chưa lắp đặt');
  assert.equal(vmUninstalled.fillCategoryBadgeText, 'Chưa lắp đặt');
  assert.equal(vmUninstalled.displayPercentage, '—');
  assert.equal(vmUninstalled.tone, 'unavailable');
  console.log('  -> PASS');

  // Test MS-5: Station B with missing uninstalled bins generates synthetic placeholders
  console.log('MS-5: Station B with missing uninstalled bins generates synthetic placeholders');
  const onlyRecyclableBin = [mockBins[3]]; // Only Recyclable of Station B
  const groupsSparse = groupBinsByStation(onlyRecyclableBin, mockStations);
  const stBSparse = groupsSparse.find(g => g.code === 'STATION_B');
  assert.ok(stBSparse);
  assert.equal(stBSparse!.compartments.length, 3);
  const sparseOrganic = stBSparse!.compartments.find(c => c.key === 'ORGANIC');
  assert.ok(sparseOrganic && sparseOrganic.bin);
  assert.equal(sparseOrganic.bin!.installed, false);
  const vmSparseOrganic = computeBinViewModel(sparseOrganic.bin);
  assert.equal(vmSparseOrganic.isUninstalled, true);
  assert.equal(vmSparseOrganic.statusBadgeText, 'Chưa lắp đặt');
  console.log('  -> PASS');

  // Test MS-6: Legacy bins without stationCode default to Station A
  console.log('MS-6: Legacy bins without stationCode default to Station A');
  const legacyBins: (Bin & { distanceCm: number | null })[] = [
    {
      id: 'legacy-1',
      binCode: 'ORGANIC',
      name: 'Rác hữu cơ',
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
      // No stationId or station
    }
  ];
  const groupsLegacy = groupBinsByStation(legacyBins, []);
  assert.equal(groupsLegacy.length, 1);
  assert.equal(groupsLegacy[0].code, 'STATION_A');
  assert.equal(groupsLegacy[0].installedCount, 1);
  console.log('  -> PASS');

  // Test MS-7: Average fill percentage calculation
  console.log('MS-7: Average fill percentage calculation for Station A');
  // Station A bins: 25, 58, 78 -> avg = (25+58+78)/3 = 53.67 -> 54%
  assert.equal(stA!.averageFillPct, 54);
  // Station B installed bin: 10 -> avg = 10%
  assert.equal(stB!.averageFillPct, 10);
  console.log('  -> PASS');

  // Test MS-8: KPI counts across multi-station data
  console.log('MS-8: KPI counts verification');
  const totalStations = groups.length;
  assert.equal(totalStations, 2);
  const installedBins = mockBins.filter(b => b.installed !== false);
  assert.equal(installedBins.length, 4); // 3 of A + 1 of B
  const onlineStations = groups.filter(g => g.status === 'ONLINE').length;
  assert.equal(onlineStations, 2); // Both Station A and Station B have active online bins

  // If Station B's only installed bin goes OFFLINE:
  const binsWithBOffline = mockBins.map(b => b.id === 'bin-b-recyclable' ? { ...b, status: 'OFFLINE' as const, currentFillLevel: null } : b);
  const groupsWithBOffline = groupBinsByStation(binsWithBOffline, []);
  const onlineCountWhenBOffline = groupsWithBOffline.filter(g => g.status === 'ONLINE').length;
  assert.equal(onlineCountWhenBOffline, 1); // Station A is ONLINE, Station B is OFFLINE
  console.log('  -> PASS');

  console.log('\n=== ALL 8 MULTI-STATION TESTS PASSED CLEANLY! ===\n');
}

runTests();
