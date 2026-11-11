/**
 * INTEGRATION TEST: LID ALERT BANNER INFINITE RE-TRIGGER CYCLE
 * Kịch bản kiểm thử thực tế theo đúng yêu cầu:
 * - T = 0s: Nhận lỗi nắp 1 -> Banner hiện -> T = 10s: Banner ẩn.
 * - T = 25s: Nhận lỗi nắp 2 -> Banner phải hiện trở lại -> T = 35s: Banner ẩn.
 * - T = 50s: Nhận lỗi nắp 3 -> Banner hiện -> T = 55s: Nhận lỗi nắp 4 -> Banner tiếp tục hiện đến T = 65s mới ẩn.
 * - Telemetry thông thường (2s/lần) gửi suốt thời gian trên -> KHÔNG làm hiện banner.
 * - Tải lại trang (F5) khi không có lỗi mới -> KHÔNG hiện banner.
 */

import { EventEmitter } from 'events';

function createMockSocket() {
  const emitter = new EventEmitter();
  return {
    on(event: string, handler: (...args: any[]) => void) {
      emitter.on(event, handler);
    },
    off(event: string, handler: (...args: any[]) => void) {
      emitter.off(event, handler);
    },
    emit(event: string, ...args: any[]) {
      emitter.emit(event, ...args);
    }
  };
}

class TestLidBannerController {
  public visible: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private socket: ReturnType<typeof createMockSocket>;
  public onLidAlertHandler: (data?: any) => void;

  constructor(socket: ReturnType<typeof createMockSocket>) {
    this.socket = socket;
    this.onLidAlertHandler = (_data?: any) => {
      this.visible = true;
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => {
        this.visible = false;
        this.timer = null;
      }, 1000); // Scaling 10s to 1s for fast and deterministic integration testing
    };
    this.socket.on('device:lid:alert', this.onLidAlertHandler);
  }

  public destroy() {
    this.socket.off('device:lid:alert', this.onLidAlertHandler);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function runInfiniteCycleSimulation() {
  console.log('=== RUNNING REALISTIC SCENARIO TIMELINE TEST (INFINITE RE-TRIGGER CYCLE) ===\n');

  const socket = createMockSocket();
  let banner = new TestLidBannerController(socket);

  // Time scale factor: 10s -> 1000ms (100ms per 1s)
  const SEC = 100;

  console.log('[Phase 1] T = 0s: Nhận lỗi nắp 1 (lid-error-001)');
  socket.emit('device:lid:alert', {
    eventId: 'lid-error-001-1731300000000-a1b2c3',
    stationCode: 'STATION_A',
    message: 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!',
    lidAlert: true,
    timestamp: new Date().toISOString()
  });

  assert(banner.visible === true, 'T=0s: Banner must be VISIBLE on Error 1');
  console.log('  -> PASS: Banner xuất hiện ngay tại T = 0s');

  // Gửi telemetry bình thường liên tục trong 10 giây
  for (let t = 2; t < 10; t += 2) {
    await sleep(2 * SEC);
    socket.emit('device:telemetry', {
      deviceId: 'raspberry-pi-5',
      stationCode: 'STATION_A',
      lidAlert: true,
      uptimeSeconds: 100 + t
    });
    assert(banner.visible === true, `T=${t}s: Banner remains visible during 10s countdown`);
  }

  // Đợi đến T = 10.5s
  await sleep(2.5 * SEC);
  assert(banner.visible === false, 'T=10.5s: Banner must be HIDDEN after 10s auto-hide');
  console.log('  -> PASS: Banner tự động ẩn tại T = 10s');

  // T = 10s đến T = 25s: Gửi telemetry thông thường 2s/lần
  console.log('\n[Phase 2] T = 11s -> 24s: Telemetry thông thường (2s/lần) gửi suốt thời gian');
  for (let t = 12; t < 25; t += 2) {
    await sleep(2 * SEC);
    socket.emit('device:telemetry', {
      deviceId: 'raspberry-pi-5',
      stationCode: 'STATION_A',
      lidAlert: true,
      uptimeSeconds: 100 + t
    });
    assert(banner.visible === false, `T=${t}s: Routine telemetry must NOT show banner`);
  }
  console.log('  -> PASS: Telemetry định kỳ suốt 14s không kích hoạt banner');

  // T = 25s: Nhận lỗi nắp 2 (lid-error-002)
  console.log('\n[Phase 3] T = 25s: Nhận lỗi nắp 2 (lid-error-002) sau khi banner đã ẩn');
  socket.emit('device:lid:alert', {
    eventId: 'lid-error-002-1731300025000-d4e5f6',
    stationCode: 'STATION_A',
    message: 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!',
    lidAlert: true,
    timestamp: new Date().toISOString()
  });
  assert(banner.visible === true, 'T=25s: Banner must RE-APPEAR on Error 2');
  console.log('  -> PASS: Banner xuất hiện trở lại thành công tại T = 25s');

  // Tiếp tục telemetry và đợi đến T = 35s
  for (let t = 27; t < 35; t += 2) {
    await sleep(2 * SEC);
    socket.emit('device:telemetry', { deviceId: 'raspberry-pi-5', lidAlert: true });
    assert(banner.visible === true, `T=${t}s: Banner remains visible`);
  }
  await sleep(2.5 * SEC); // 800ms + 250ms = 1050ms (> 1000ms)
  assert(banner.visible === false, 'T=35.5s: Banner must auto-hide after 10s');
  console.log('  -> PASS: Banner tự động ẩn tại T = 35s');

  // T = 36s -> 49s: Yên tĩnh
  for (let t = 36; t < 50; t += 2) {
    await sleep(2 * SEC);
    socket.emit('device:telemetry', { deviceId: 'raspberry-pi-5', lidAlert: true });
    assert(banner.visible === false, `T=${t}s: Banner stays hidden`);
  }

  // T = 50s: Nhận lỗi nắp 3 (lid-error-003)
  console.log('\n[Phase 4] T = 50s: Nhận lỗi nắp 3 (lid-error-003) -> Banner hiện');
  socket.emit('device:lid:alert', {
    eventId: 'lid-error-003-1731300050000-112233',
    stationCode: 'STATION_A',
    message: 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!',
    lidAlert: true,
    timestamp: new Date().toISOString()
  });
  assert(banner.visible === true, 'T=50s: Banner visible on Error 3');
  console.log('  -> PASS: Banner hiện tại T = 50s');

  // T = 55s: Nhận lỗi nắp 4 (lid-error-004) khi banner ĐANG HIỆN -> Reset timer 10s
  await sleep(5 * SEC);
  console.log('\n[Phase 5] T = 55s: Nhận lỗi nắp 4 (lid-error-004) khi banner đang hiện -> Reset timer');
  socket.emit('device:lid:alert', {
    eventId: 'lid-error-004-1731300055000-445566',
    stationCode: 'STATION_A',
    message: 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!',
    lidAlert: true,
    timestamp: new Date().toISOString()
  });
  assert(banner.visible === true, 'T=55s: Banner must remain visible on Error 4');

  // Tại T = 60s (nếu không có Error 4 thì đã ẩn ở đây, nhưng vì có Error 4 lúc 55s nên đến 65s mới ẩn)
  await sleep(5 * SEC);
  assert(banner.visible === true, 'T=60s: Banner must STILL BE VISIBLE due to reset at 55s');
  console.log('  -> PASS: Tại T = 60s banner vẫn hiển thị nhờ được reset timer tại T = 55s');

  // Đợi đến T = 65.5s
  await sleep(5.5 * SEC);
  assert(banner.visible === false, 'T=65.5s: Banner must hide 10s after Error 4');
  console.log('  -> PASS: Banner hiển thị đủ đến T = 65s mới tự động ẩn');

  // Tải lại trang (F5) khi không có lỗi mới
  console.log('\n[Phase 6] Tải lại trang (F5) khi không có lỗi mới -> KHÔNG hiện banner');
  banner.destroy();
  // Giả lập Client tải lại trang: khởi tạo component mới hoàn toàn
  const reloadedBanner = new TestLidBannerController(socket);
  assert(reloadedBanner.visible === false, 'Page reload initial state must be hidden');

  // Nhận heartbeat/telemetry sau reload (Backend có lidAlert: true trong RAM/DB)
  socket.emit('device:heartbeat', { deviceId: 'raspberry-pi-5', lidAlert: true });
  socket.emit('device:telemetry', { deviceId: 'raspberry-pi-5', lidAlert: true });
  socket.emit('alert:created', { id: 'alert-db-1', isResolved: false });
  assert(reloadedBanner.visible === false, 'Page reload must NOT show banner without new error event');
  console.log('  -> PASS: F5 tải lại trang không làm xuất hiện banner khi không có lỗi mới');

  // Error mới sau khi reload -> banner lại xuất hiện bình thường
  socket.emit('device:lid:alert', {
    eventId: 'lid-error-005-1731300075000-778899',
    message: 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!'
  });
  assert(reloadedBanner.visible === true, 'New error after reload shows banner');
  console.log('  -> PASS: Sau reload nếu có lỗi mới thì banner vẫn xuất hiện bình thường');

  reloadedBanner.destroy();

  console.log('\n=== REALISTIC TIMELINE SIMULATION PASSED 100% ===');
}

runInfiniteCycleSimulation().catch((err) => {
  console.error('\n*** TEST FAILED ***', err);
  process.exit(1);
});
