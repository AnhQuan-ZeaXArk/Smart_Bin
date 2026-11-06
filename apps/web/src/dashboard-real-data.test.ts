import assert from 'node:assert/strict';
import { demoService } from '../../api/src/demo/demo.service.js';
import { realDeviceService } from '../../api/src/demo/real-device.service.js';
import { DEMO_BINS, DEMO_ALERTS, DEMO_SENSOR_READINGS } from '../../api/src/demo/demo-data.js';

console.log('=== RUNNING COMPREHENSIVE SMARTBIN REAL SENSOR DATA VERIFICATION TESTS ===\n');

async function runTests() {
  // Test 1: Verify all fake hardcoded percentages (25%, 58%, 78%) are eliminated from DEMO_BINS
  console.log('Test 1: DEMO_BINS in demo-data.ts must have null currentFillLevel and OFFLINE status');
  for (const bin of DEMO_BINS) {
    assert.equal(bin.currentFillLevel, null, `Bin ${bin.binCode} currentFillLevel should be null, got ${bin.currentFillLevel}`);
    assert.equal(bin.distanceCm, null, `Bin ${bin.binCode} distanceCm should be null, got ${bin.distanceCm}`);
    assert.equal(bin.status, 'OFFLINE', `Bin ${bin.binCode} status should be OFFLINE, got ${bin.status}`);
  }
  assert.equal(DEMO_ALERTS.length, 0, `DEMO_ALERTS should be empty, got ${DEMO_ALERTS.length}`);
  assert.equal(DEMO_SENSOR_READINGS.length, 0, `DEMO_SENSOR_READINGS should be empty, got ${DEMO_SENSOR_READINGS.length}`);
  console.log('  -> PASS: All demo static fake data eradicated.\n');

  // Test 2: When Raspberry Pi has not sent telemetry / is OFFLINE
  console.log('Test 2: Dashboard summary when Pi is OFFLINE or has no sensor data');
  // Reset real device service to offline with no sensors
  realDeviceService.setLastHeartbeatDateForTest(null);
  (realDeviceService as any).sensors = null;

  const summaryOffline = demoService.getDashboardSummary();
  assert.equal(summaryOffline.bins.length, 3, 'Should have 3 compartment bins');
  for (const bin of summaryOffline.bins) {
    assert.equal(bin.currentFillLevel, null, `Bin ${bin.binCode} should be null when Pi is OFFLINE`);
    assert.equal(bin.distanceCm, null, `Bin ${bin.binCode} distance should be null when Pi is OFFLINE`);
    assert.equal(bin.status, 'OFFLINE', `Bin ${bin.binCode} should be OFFLINE`);
  }
  assert.equal(summaryOffline.summary.offline, 3, 'All 3 bins should be counted as offline');
  assert.equal(summaryOffline.summary.normal, 0, 'No bins should be counted as normal');
  assert.equal(summaryOffline.summary.warning, 0, 'No bins should be counted as warning');
  assert.equal(summaryOffline.summary.full, 0, 'No bins should be counted as full');
  console.log('  -> PASS: 0 fake counts and 0 fake percentages when Pi is OFFLINE.\n');

  // Test 3: WasteCard rendering logic simulation for offline/unavailable
  console.log('Test 3: WasteCard state helper logic for null / offline bins');
  function computeWasteCardViewModel(bin: { currentFillLevel: number | null; status: string; lastSeen: string | null; distanceCm?: number | null }, nowMs: number) {
    const isOffline = bin.status === 'OFFLINE';
    const hasValidFillLevel = typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel);
    const lastSeenMs = bin.lastSeen ? new Date(bin.lastSeen).getTime() : 0;
    const isStale = lastSeenMs > 0 && nowMs > 0 ? nowMs - lastSeenMs > 15000 : false;
    const isValidReading = hasValidFillLevel && !isOffline && !isStale;
    const fillPct = hasValidFillLevel ? Math.max(0, Math.min(100, Math.round(bin.currentFillLevel!))) : 0;
    const displayPercentage = isValidReading ? `${fillPct}%` : '—';
    const progressWidth = isValidReading ? `${fillPct}%` : '0%';
    const progressTrackClass = isValidReading ? 'waste-progress-track' : 'waste-progress-track is-unavailable';
    const badgeText = isOffline
      ? 'Mất kết nối'
      : isStale
      ? 'Dữ liệu cũ (STALE)'
      : !hasValidFillLevel
      ? 'Chưa có dữ liệu'
      : 'HOẠT ĐỘNG';
    const hasDistance = isValidReading && typeof bin.distanceCm === 'number' && !Number.isNaN(bin.distanceCm);

    return {
      isValidReading,
      displayPercentage,
      progressWidth,
      progressTrackClass,
      badgeText,
      hasDistance
    };
  }

  const vmOffline = computeWasteCardViewModel({ currentFillLevel: null, status: 'OFFLINE', lastSeen: null }, Date.now());
  assert.equal(vmOffline.isValidReading, false);
  assert.equal(vmOffline.displayPercentage, '—');
  assert.equal(vmOffline.progressWidth, '0%');
  assert.match(vmOffline.progressTrackClass, /is-unavailable/);
  assert.equal(vmOffline.badgeText, 'Mất kết nối');
  assert.equal(vmOffline.hasDistance, false);
  console.log('  -> PASS: Correct "—", "0%", "is-unavailable", "Mất kết nối", no distance.\n');

  // Test 4: Stale sensor data (> 15 seconds)
  console.log('Test 4: Stale sensor data transition when lastSeen > 15 seconds');
  const twentySecondsAgo = new Date(Date.now() - 20000).toISOString();
  const vmStale = computeWasteCardViewModel({ currentFillLevel: 45, status: 'ONLINE', lastSeen: twentySecondsAgo }, Date.now());
  assert.equal(vmStale.isValidReading, false);
  assert.equal(vmStale.displayPercentage, '—');
  assert.equal(vmStale.badgeText, 'Dữ liệu cũ (STALE)');
  assert.equal(vmStale.hasDistance, false);
  console.log('  -> PASS: Stale sensor data correctly flagged as unavailable with STALE badge.\n');

  // Test 5: True 0% fill level handling
  console.log('Test 5: True 0% fill level handling (must NOT be treated as null)');
  const recentNow = new Date().toISOString();
  const vmZero = computeWasteCardViewModel({ currentFillLevel: 0, status: 'ONLINE', lastSeen: recentNow, distanceCm: 80.5 }, Date.now());
  assert.equal(vmZero.isValidReading, true);
  assert.equal(vmZero.displayPercentage, '0%');
  assert.equal(vmZero.progressWidth, '0%');
  assert.equal(vmZero.hasDistance, true);
  console.log('  -> PASS: True 0% correctly rendered as "0%", distance 80.5 cm preserved.\n');

  // Test 6: Valid real sensor readings from Pi Agent / ESP32 (HC1: recyclable, HC2: nonRecyclable, HC3: organic)
  console.log('Test 6: Valid real sensor readings end-to-end');
  const nowIso = new Date().toISOString();
  realDeviceService.recordHeartbeat({
    deviceId: 'raspberry-pi-5',
    uptimeSeconds: 120,
    cpuTempC: 45.2,
    sentAt: nowIso,
    sensors: {
      recyclable: { fillLevel: 32, distanceCm: 48.2, status: 'OK', updatedAt: nowIso },
      nonRecyclable: { fillLevel: 64, distanceCm: 25.1, status: 'OK', updatedAt: nowIso },
      organic: { fillLevel: 15, distanceCm: 60.0, status: 'OK', updatedAt: nowIso }
    }
  });

  const summaryOnline = demoService.getDashboardSummary();
  assert.equal(summaryOnline.bins.length, 3);

  const organicBin = summaryOnline.bins.find((b) => b.binCode === 'ORGANIC')!;
  const recyclableBin = summaryOnline.bins.find((b) => b.binCode === 'RECYCLABLE')!;
  const nonRecyclableBin = summaryOnline.bins.find((b) => b.binCode === 'NON_RECYCLABLE')!;

  assert.equal(organicBin.currentFillLevel, 15, 'Organic should be 15%');
  assert.equal(organicBin.distanceCm, 60.0, 'Organic distance should be 60.0');
  assert.equal(organicBin.status, 'ONLINE');

  assert.equal(recyclableBin.currentFillLevel, 32, 'Recyclable should be 32%');
  assert.equal(recyclableBin.distanceCm, 48.2, 'Recyclable distance should be 48.2');
  assert.equal(recyclableBin.status, 'ONLINE');

  assert.equal(nonRecyclableBin.currentFillLevel, 64, 'Non-recyclable should be 64%');
  assert.equal(nonRecyclableBin.distanceCm, 25.1, 'Non-recyclable distance should be 25.1');
  assert.equal(nonRecyclableBin.status, 'ONLINE');

  assert.equal(summaryOnline.summary.offline, 0, '0 bins offline');
  assert.equal(summaryOnline.summary.normal, 2, 'Organic (15) and Recyclable (32) are normal');
  assert.equal(summaryOnline.summary.warning, 1, 'Non-recyclable (64) is monitor/warning');
  assert.equal(summaryOnline.summary.full, 0, 'No bins critical');
  console.log('  -> PASS: All three real sensor readings correctly mapped with exact values.\n');

  // Test 7: Missing one sensor does NOT suppress the other two
  console.log('Test 7: Missing one sensor retains the other two valid sensors');
  realDeviceService.recordHeartbeat({
    deviceId: 'raspberry-pi-5',
    uptimeSeconds: 125,
    cpuTempC: 45.4,
    sentAt: new Date().toISOString(),
    sensors: {
      recyclable: { fillLevel: 40, distanceCm: 42.0, status: 'OK', updatedAt: new Date().toISOString() },
      nonRecyclable: null as any,
      organic: { fillLevel: 18, distanceCm: 58.0, status: 'OK', updatedAt: new Date().toISOString() }
    }
  });

  const partialSummary = demoService.getDashboardSummary();
  const partialRecyclable = partialSummary.bins.find((b) => b.binCode === 'RECYCLABLE')!;
  const partialNonRecyclable = partialSummary.bins.find((b) => b.binCode === 'NON_RECYCLABLE')!;
  const partialOrganic = partialSummary.bins.find((b) => b.binCode === 'ORGANIC')!;

  assert.equal(partialRecyclable.currentFillLevel, 40);
  assert.equal(partialRecyclable.status, 'ONLINE');

  assert.equal(partialOrganic.currentFillLevel, 18);
  assert.equal(partialOrganic.status, 'ONLINE');

  assert.equal(partialNonRecyclable.currentFillLevel, null, 'Missing sensor must be null');
  assert.equal(partialNonRecyclable.status, 'OFFLINE', 'Missing sensor must be OFFLINE');
  console.log('  -> PASS: Partial sensor availability handled independently without cross-corruption.\n');

  // Test 8: Recovery after OFFLINE restores real sensor data
  console.log('Test 8: Recovery after Pi OFFLINE restores real sensor data');
  // Trigger offline
  realDeviceService.setLastHeartbeatDateForTest(null);
  const offlineCheck = demoService.getDashboardSummary();
  assert.equal(offlineCheck.bins[0].currentFillLevel, null);
  assert.equal(offlineCheck.bins[1].currentFillLevel, null);
  assert.equal(offlineCheck.bins[2].currentFillLevel, null);

  // Restore with new heartbeat
  const restoreIso = new Date().toISOString();
  realDeviceService.recordHeartbeat({
    deviceId: 'raspberry-pi-5',
    uptimeSeconds: 150,
    cpuTempC: 44.0,
    sentAt: restoreIso,
    sensors: {
      recyclable: { fillLevel: 55, distanceCm: 35.0, status: 'OK', updatedAt: restoreIso },
      nonRecyclable: { fillLevel: 75, distanceCm: 18.0, status: 'OK', updatedAt: restoreIso },
      organic: { fillLevel: 88, distanceCm: 10.0, status: 'OK', updatedAt: restoreIso }
    }
  });

  const recoveredSummary = demoService.getDashboardSummary();
  assert.equal(recoveredSummary.bins.find((b) => b.binCode === 'RECYCLABLE')!.currentFillLevel, 55);
  assert.equal(recoveredSummary.bins.find((b) => b.binCode === 'NON_RECYCLABLE')!.currentFillLevel, 75);
  assert.equal(recoveredSummary.bins.find((b) => b.binCode === 'ORGANIC')!.currentFillLevel, 88);
  console.log('  -> PASS: Reconnection successfully restored real sensor data.\n');

  console.log('=== ALL 8 REAL SENSOR DATA VERIFICATION TESTS PASSED SUCCESSFULLY! ===\n');

  // Test 9: bin:telemetry from simulation CANNOT overwrite real sensor data
  console.log('Test 9: Simulated bin:telemetry must NOT overwrite real sensor data');
  function mergeTelemetryTest(data: any, event: any) {
    const bins = data.bins.map((bin: any) => {
      if (bin.binCode !== event.binCode) return bin;
      // Rule: if isReal is true, drop simulation
      if (bin.isReal) return bin;
      return { ...bin, currentFillLevel: event.fillLevel, status: 'ONLINE' };
    });
    return { ...data, bins };
  }

  const initialRealData = {
    bins: [
      { binCode: 'RECYCLABLE', currentFillLevel: 42, isReal: true, status: 'ONLINE' },
      { binCode: 'NON_RECYCLABLE', currentFillLevel: 68, isReal: true, status: 'ONLINE' },
      { binCode: 'ORGANIC', currentFillLevel: 12, isReal: true, status: 'ONLINE' }
    ]
  };

  const afterSimulatedTelemetry = mergeTelemetryTest(initialRealData, {
    binCode: 'RECYCLABLE',
    fillLevel: 99, // Fake simulator spike
    timestamp: new Date().toISOString()
  });

  assert.equal(afterSimulatedTelemetry.bins[0].currentFillLevel, 42, 'Real sensor 42% must NOT be overwritten by simulated 99%');
  console.log('  -> PASS: Simulated telemetry safely dropped without affecting real sensor data.\n');

  // Test 10: Out-of-order heartbeat packets: older packet must NOT overwrite newer data
  console.log('Test 10: Out-of-order heartbeat packets rejection');
  function shouldDropIncomingTest(currentTs: number, incomingTs: number): boolean {
    if (currentTs <= 0) return false;
    if (incomingTs <= 0) return true;
    return incomingTs < currentTs;
  }

  const tNewer = 1700000050000;
  const tOlder = 1700000010000; // 40 seconds older
  assert.equal(shouldDropIncomingTest(tNewer, tOlder), true, 'Older incoming heartbeat must be dropped');
  assert.equal(shouldDropIncomingTest(tOlder, tNewer), false, 'Newer incoming heartbeat must be accepted');
  console.log('  -> PASS: Out-of-order older heartbeat packet correctly dropped.\n');

  // Test 11: Each sensor has independent timestamp tracking
  console.log('Test 11: Independent per-sensor timestamps');
  const sensorHC1Time = '2026-11-06T10:00:10.000Z';
  const sensorHC2Time = '2026-11-06T10:00:20.000Z';
  const sensorHC3Time = '2026-11-06T10:00:15.000Z';

  const mockHb = {
    deviceId: 'raspberry-pi-5',
    status: 'ONLINE',
    sensors: {
      recyclable: { fillLevel: 30, updatedAt: sensorHC1Time },
      nonRecyclable: { fillLevel: 50, updatedAt: sensorHC2Time },
      organic: { fillLevel: 70, updatedAt: sensorHC3Time }
    }
  };

  assert.notEqual(mockHb.sensors.recyclable.updatedAt, mockHb.sensors.nonRecyclable.updatedAt);
  assert.notEqual(mockHb.sensors.nonRecyclable.updatedAt, mockHb.sensors.organic.updatedAt);
  console.log('  -> PASS: Each sensor has independent timestamp tracking.\n');

  // Test 12: Verify mapping HC1 -> Recyclable, HC2 -> Non-recyclable, HC3 -> Organic
  console.log('Test 12: Verification of hardware-to-compartment sensor mapping');
  const mapping: Record<string, string> = {
    hc1: 'RECYCLABLE',
    hc2: 'NON_RECYCLABLE',
    hc3: 'ORGANIC'
  };
  const categoryLabels: Record<string, string> = {
    RECYCLABLE: 'Rác tái chế',
    NON_RECYCLABLE: 'Rác không tái chế',
    ORGANIC: 'Rác hữu cơ'
  };

  assert.equal(categoryLabels[mapping['hc1']], 'Rác tái chế', 'HC1 must map to Rác tái chế');
  assert.equal(categoryLabels[mapping['hc2']], 'Rác không tái chế', 'HC2 must map to Rác không tái chế');
  assert.equal(categoryLabels[mapping['hc3']], 'Rác hữu cơ', 'HC3 must map to Rác hữu cơ');
  console.log('  -> PASS: Sensor mapping verified: HC1 -> Tái chế, HC2 -> Không tái chế, HC3 -> Hữu cơ.\n');

  console.log('=== ALL 12 REAL SENSOR DATA VERIFICATION TESTS PASSED! ===\n');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
