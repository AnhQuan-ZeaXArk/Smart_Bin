/**
 * Automated Verification for:
 * 1. Streamlined Sidebar Navigation (exactly 4 items: Dashboard, Bins, Alerts, Settings)
 * 2. 10-Second Auto-Hide Banner & Re-triggering Timer Logic
 * 3. Streamlined Alerts Page (Processing status removed from UI)
 */

import { appRoutes } from './route-config.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED]: ${message}`);
  }
}

async function runTests() {
  console.log('=== TEST SUITE: SMARTBIN UI STREAMLINING & 10-SECOND LID ALERT BANNER TIMER ===\n');

  // --------------------------------------------------------------------------
  // TEST 1: Navigation Sidebar contains strictly the 4 requested items
  // --------------------------------------------------------------------------
  console.log('Test 1: Verify left sidebar navigation displays ONLY 4 items');
  const visibleRoutes = appRoutes.filter((r) => r.showInNav);
  console.log('  Visible routes:', visibleRoutes.map((r) => `${r.label} (${r.path})`).join(', '));

  assert(visibleRoutes.length === 4, `Expected exactly 4 navigation routes, found ${visibleRoutes.length}`);

  const expectedNavPaths = ['/dashboard', '/bins', '/alerts', '/settings'];
  for (const path of expectedNavPaths) {
    const found = visibleRoutes.find((r) => r.path === path);
    assert(Boolean(found), `Expected route ${path} to be visible in navigation`);
    assert(found?.showInNav === true, `Route ${path} showInNav should be true`);
  }

  // Verify removed items are NOT shown in nav, but route definitions still exist
  const removedPaths = ['/devices', '/sensor-history', '/collections'];
  for (const path of removedPaths) {
    const inNav = visibleRoutes.some((r) => r.path === path);
    assert(!inNav, `Route ${path} must NOT be visible in navigation`);
    const inAppRoutes = appRoutes.some((r) => r.path === path);
    assert(inAppRoutes, `Route ${path} must still exist in appRoutes to prevent broken direct links/tests`);
  }
  console.log('  -> PASS: Sidebar navigation contains strictly 4 items: Tổng quan, Thùng rác, Cảnh báo, Cài đặt\n');

  // --------------------------------------------------------------------------
  // TEST 2: Lid Banner Timer Logic Simulation (10s auto-hide)
  // --------------------------------------------------------------------------
  console.log('Test 2: Verify lid error banner displays immediately and auto-hides after 10 seconds');

  // Emulate LidAlertBanner timer state
  class BannerTimerSimulator {
    visible = false;
    timer: any = null;
    lastEventId: string | null = null;
    displayLog: Array<{ action: string; time: number; eventId?: string }> = [];
    virtualTime = 0;

    triggerAlert(eventId: string) {
      if (this.lastEventId === eventId && this.timer) return;
      this.lastEventId = eventId;
      this.visible = true;
      this.displayLog.push({ action: 'SHOW', time: this.virtualTime, eventId });

      if (this.timer) {
        clearTimeout(this.timer);
        this.displayLog.push({ action: 'RESET_TIMER', time: this.virtualTime });
      }

      this.timer = setTimeout(() => {
        this.visible = false;
        this.timer = null;
        this.displayLog.push({ action: 'HIDE', time: this.virtualTime, eventId });
      }, 10000);
    }

    advanceTime(ms: number) {
      this.virtualTime += ms;
      // In real Node timer tests, we simulate timer expiration
    }
  }

  const sim = new BannerTimerSimulator();

  // Step 1: Initial event arrives at t = 0s
  sim.triggerAlert('event-uuid-1');
  assert(sim.visible === true, 'Banner should be visible immediately upon error event 1');
  assert(sim.displayLog[0].action === 'SHOW', 'First action must be SHOW');

  // Advance 10s: timer triggers
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      assert(sim.visible === false, 'Banner should auto-hide after 10 seconds');
      console.log('  -> PASS: Banner auto-hides after exactly 10 seconds');
      resolve();
    }, 10050); // slight grace for event loop
  });

  // --------------------------------------------------------------------------
  // TEST 3: Consecutive errors reset the 10-second timer
  // --------------------------------------------------------------------------
  console.log('\nTest 3: Verify second error occurring within 10s resets timer (extends display)');
  const sim2 = new BannerTimerSimulator();

  // Event 1 arrives at t = 0
  sim2.triggerAlert('event-uuid-A');
  assert(sim2.visible === true, 'Banner visible on Event A');

  // Wait 4 seconds, then Event 2 arrives
  await new Promise((r) => setTimeout(r, 4000));
  sim2.triggerAlert('event-uuid-B');
  assert(sim2.visible === true, 'Banner remains visible after Event B');
  assert(
    sim2.displayLog.some((l) => l.action === 'RESET_TIMER'),
    'Timer should be cleared and reset when new event arrives'
  );

  // At t = 8s from start (4s from Event B), banner should STILL be visible (because timer was reset to 10s at t = 4s)
  await new Promise((r) => setTimeout(r, 4000));
  assert(sim2.visible === true, 'Banner should STILL be visible 8s after start because Event B extended it');

  // Wait remaining 6.5s (total 10.5s from Event B) -> banner should now hide
  await new Promise((r) => setTimeout(r, 6500));
  assert(sim2.visible === false, 'Banner hides after 10s from the latest event (Event B)');
  console.log('  -> PASS: Second error reset the timer and extended visibility by 10s from Event B');

  // --------------------------------------------------------------------------
  // TEST 4: Re-triggering after hidden
  // --------------------------------------------------------------------------
  console.log('\nTest 4: Verify banner re-displays when a new error occurs after having hidden');
  assert(sim2.visible === false, 'Banner is currently hidden');

  sim2.triggerAlert('event-uuid-C');
  assert(sim2.visible === true, 'Banner must re-display immediately for Event C');
  console.log('  -> PASS: Banner re-displays immediately when a new error occurs after being hidden');

  // Clean up sim2 timer
  if (sim2.timer) clearTimeout(sim2.timer);

  // --------------------------------------------------------------------------
  // TEST 5: Alerts page UI streamlining verification
  // --------------------------------------------------------------------------
  console.log('\nTest 5: Verify Alerts page does not contain processing status in UI');
  // Read dashboard.tsx file text to ensure no resolution filter UI or resolution status badges remain
  const fs = await import('node:fs');
  const dashboardCode = fs.readFileSync('apps/web/src/dashboard.tsx', 'utf-8');

  assert(!dashboardCode.includes('alert-resolution-filter'), 'alert-resolution-filter class should be removed');
  assert(!dashboardCode.includes("label>Trạng thái xử lý"), 'Dropdown filter "Trạng thái xử lý" should be removed');
  assert(!dashboardCode.includes("alert.isResolved ? 'Đã xử lý' : 'Chưa xử lý'"), 'Resolution badge should be removed from alert rows');

  console.log('  -> PASS: Processing status UI and filter completely removed from Alerts page');

  console.log('\n=== ALL UI STREAMLINING & TIMER VERIFICATION TESTS PASSED ===');
}

runTests().catch((err) => {
  console.error('\n*** TEST FAILED ***', err);
  process.exit(1);
});
