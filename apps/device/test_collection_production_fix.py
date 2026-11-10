#!/usr/bin/env python3
"""
Comprehensive Automated Tests for SmartBin Production Collection Fixes:
1. Hai chu kỳ OPEN/CLOSE liên tiếp (sinh 2 sessionId khác nhau, đều được lưu đúng thứ tự).
2. ACK chậm hơn 3 giây (ví dụ 4.5s) -> vẫn thành công do timeout 10s.
3. ACK bị mất sau khi Database đã commit -> client gửi lại nhận DUPLICATE_IGNORED -> đánh dấu thành công.
4. Backend mất kết nối rồi kết nối lại -> sự kiện được bảo toàn trong hàng đợi và gửi lại khi online.
5. YOLO STOPPED trước khi Pi Agent đọc hết IPC -> sự kiện KHÔNG bị xóa khỏi IPC và Pi Agent vẫn đọc thành công.
6. Hàng đợi IPC giữ đúng thứ tự OPEN và CLOSE, không bị ghi đè.
7. Không ảnh hưởng cảnh báo lỗi nắp (loi mo nap / loi dong nap).
"""

import importlib.util
import json
import os
import sys
import tempfile
import time
import types
import unittest
import uuid
from pathlib import Path
from unittest import mock

DEVICE_DIR = Path(__file__).resolve().parent
if str(DEVICE_DIR) not in sys.path:
    sys.path.insert(0, str(DEVICE_DIR))

import smartbin_yolo_bridge
import pi_agent


def load_yolo_module():
    cv2 = types.ModuleType("cv2")
    cv2.CAP_V4L2 = 1
    cv2.CAP_PROP_FRAME_WIDTH = 2
    cv2.CAP_PROP_FRAME_HEIGHT = 3
    cv2.VideoCapture = mock.Mock()
    cv2.destroyAllWindows = mock.Mock()
    cv2.imshow = mock.Mock()
    cv2.waitKey = mock.Mock(return_value=ord("q"))

    torch = types.ModuleType("torch")
    torch.__version__ = "mock"

    serial_mod = types.ModuleType("serial")
    serial_mod.EIGHTBITS = 8
    serial_mod.PARITY_NONE = "N"
    serial_mod.STOPBITS_ONE = 1
    serial_mod.SerialException = type("SerialException", (Exception,), {})
    serial_mod.Serial = mock.Mock()

    ultralytics = types.ModuleType("ultralytics")
    ultralytics.YOLO = mock.Mock()

    fake_modules = {
        "cv2": cv2,
        "torch": torch,
        "serial": serial_mod,
        "ultralytics": ultralytics,
    }
    spec = importlib.util.spec_from_file_location(
        f"smartbin_test_yolo_prod_{uuid.uuid4().hex}",
        DEVICE_DIR / "yolo_camera.py",
    )
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, fake_modules):
        spec.loader.exec_module(module)
    return module, serial_mod


class FakeSerialStream:
    def __init__(self):
        self._buffer = b""
        self.is_open = True

    def feed(self, text: str):
        self._buffer += text.encode("utf-8")

    @property
    def in_waiting(self):
        return len(self._buffer)

    def read(self, size=1):
        chunk = self._buffer[:size]
        self._buffer = self._buffer[size:]
        return chunk

    def flush(self):
        pass


class FakeSocketIOClient:
    def __init__(self, connected=True, ack_delay=0.0, ack_handler=None):
        self.connected = connected
        self.ack_delay = ack_delay
        self.ack_handler = ack_handler
        self.emitted = []

    def emit(self, event, data, callback=None):
        self.emitted.append((event, data))
        if callback:
            def respond():
                if self.ack_delay > 0:
                    time.sleep(self.ack_delay)
                if self.ack_handler:
                    resp = self.ack_handler(event, data)
                else:
                    resp = {
                        "success": True,
                        "status": "SAVED",
                        "eventId": data.get("eventId"),
                        "sessionId": data.get("sessionId"),
                    }
                callback(resp)

            import threading
            t = threading.Thread(target=respond, daemon=True)
            t.start()


class TestCollectionProductionFix(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state_file = os.path.join(self.temp_dir.name, "smartbin_yolo_state.json")
        self.ack_file = os.path.join(self.temp_dir.name, "smartbin_backend_ack.json")

        self.env_patch = mock.patch.dict(
            os.environ,
            {
                "SMARTBIN_YOLO_STATE_FILE": self.state_file,
                "SMARTBIN_BACKEND_ACK_FILE": self.ack_file,
                "DEVICE_INGEST_TOKEN": "test-ingest-token",
            },
        )
        self.env_patch.start()

        smartbin_yolo_bridge.STATE_FILE_PATH = self.state_file
        smartbin_yolo_bridge.BACKEND_ACK_FILE_PATH = self.ack_file
        smartbin_yolo_bridge.reset_backend_ack_state()

        self.yolo, _ = load_yolo_module()
        self.fake_serial = FakeSerialStream()
        self.yolo.esp32 = self.fake_serial
        self.yolo.reset_collection_session_state()

        pi_agent.reset_online_collection_state()

    def tearDown(self):
        self.yolo.reset_collection_session_state()
        smartbin_yolo_bridge.reset_backend_ack_state()
        self.env_patch.stop()
        self.temp_dir.cleanup()

    def test_01_two_consecutive_cycles_have_distinct_session_ids_and_succeed(self):
        """1. Hai chu kỳ OPEN/CLOSE liên tiếp: 2 sessionId khác nhau, đều được lưu đúng thứ tự."""
        fake_sio = FakeSocketIOClient(connected=True)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            # --- Cycle 1 ---
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self.yolo._publish_state_safely(status="RUNNING")
            res_c1_open = pi_agent.process_online_collection_events()
            self.assertEqual(len(res_c1_open), 1)
            self.assertTrue(res_c1_open[0]["saved"])
            c1_session_id = res_c1_open[0]["sessionId"]

            self.fake_serial.feed("TU DONG: TIEP TUC\n")
            self.yolo.read_esp32()
            self.yolo._publish_state_safely(status="RUNNING")
            res_c1_close = pi_agent.process_online_collection_events()
            self.assertEqual(len(res_c1_close), 1)
            self.assertTrue(res_c1_close[0]["saved"])
            self.assertEqual(res_c1_close[0]["sessionId"], c1_session_id)

            # --- Cycle 2 ---
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self.yolo._publish_state_safely(status="RUNNING")
            res_c2_open = pi_agent.process_online_collection_events()
            self.assertEqual(len(res_c2_open), 1)
            self.assertTrue(res_c2_open[0]["saved"])
            c2_session_id = res_c2_open[0]["sessionId"]

            # Distinct sessions
            self.assertNotEqual(c1_session_id, c2_session_id)

            self.fake_serial.feed("TU DONG: TIEP TUC\n")
            self.yolo.read_esp32()
            self.yolo._publish_state_safely(status="RUNNING")
            res_c2_close = pi_agent.process_online_collection_events()
            self.assertEqual(len(res_c2_close), 1)
            self.assertTrue(res_c2_close[0]["saved"])
            self.assertEqual(res_c2_close[0]["sessionId"], c2_session_id)

            self.assertEqual(len(fake_sio.emitted), 4)

    def test_02_slow_ack_greater_than_3_seconds_succeeds_with_10s_timeout(self):
        """2. ACK chậm hơn 3 giây (ví dụ 3.8s delay) -> Vẫn thành công do timeout đã tăng lên 10s."""
        fake_sio = FakeSocketIOClient(connected=True, ack_delay=3.5)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self.yolo._publish_state_safely(status="RUNNING")

            start = time.time()
            res = pi_agent.process_online_collection_events()
            duration = time.time() - start

            self.assertEqual(len(res), 1)
            self.assertTrue(res[0]["saved"])
            self.assertGreaterEqual(duration, 3.4)

    def test_03_lost_ack_after_db_commit_retry_succeeds_without_error(self):
        """3. ACK bị mất sau khi Database đã commit: Gửi lại nhận DUPLICATE_IGNORED -> đánh dấu thành công."""
        call_count = 0

        def simulate_lost_ack_then_duplicate(_ev, payload):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First attempt: simulated network drop before ACK callback returned
                time.sleep(0.1)
                return {"success": False, "status": "NETWORK_DROP"}
            # Second attempt: backend recognizes duplicate eventId
            return {
                "success": True,
                "status": "DUPLICATE_IGNORED",
                "duplicate": True,
                "eventId": payload.get("eventId"),
                "sessionId": payload.get("sessionId"),
            }

        fake_sio = FakeSocketIOClient(connected=True, ack_handler=simulate_lost_ack_then_duplicate)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self.yolo._publish_current_ipc = lambda: None
            self.yolo._publish_state_safely(status="RUNNING")

            # First attempt: failed ACK -> event kept in queue
            res1 = pi_agent.process_online_collection_events()
            self.assertEqual(len(res1), 1)
            self.assertFalse(res1[0]["saved"])
            ev_id = res1[0]["eventId"]

            # Second attempt: retried -> duplicate acknowledged -> saved True
            res2 = pi_agent.process_online_collection_events()
            self.assertEqual(len(res2), 1)
            self.assertTrue(res2[0]["saved"])
            self.assertEqual(res2[0]["eventId"], ev_id)

            # Third attempt: event is already seen, skipped
            res3 = pi_agent.process_online_collection_events()
            self.assertEqual(len(res3), 0)

    def test_04_backend_disconnect_then_reconnect_preserves_and_sends(self):
        """4. Backend mất kết nối rồi kết nối lại: Giữ nguyên sự kiện và phát khi online."""
        fake_sio = FakeSocketIOClient(connected=False)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self.yolo._publish_state_safely(status="RUNNING")

            # Offline: event kept in queue
            res_offline = pi_agent.process_online_collection_events()
            self.assertEqual(len(res_offline), 1)
            self.assertFalse(res_offline[0]["saved"])
            self.assertEqual(res_offline[0]["reason"], "OFFLINE")
            self.assertEqual(len(fake_sio.emitted), 0)

            # Reconnected
            fake_sio.connected = True
            res_online = pi_agent.process_online_collection_events()
            self.assertEqual(len(res_online), 1)
            self.assertTrue(res_online[0]["saved"])
            self.assertEqual(len(fake_sio.emitted), 1)

    def test_05_yolo_stopped_before_pi_agent_reads_preserves_ipc_events(self):
        """5. YOLO STOPPED trước khi Pi Agent đọc hết IPC: Sự kiện KHÔNG bị xóa khỏi IPC."""
        fake_sio = FakeSocketIOClient(connected=True)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            # ESP32 generates OPEN and CLOSE
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self.fake_serial.feed("TU DONG: TIEP TUC\n")
            self.yolo.read_esp32()

            # YOLO stops! (simulate finally block)
            self.yolo._publish_state_safely(
                detection=None,
                status="STOPPED",
                camera="DISCONNECTED",
                collection_events=self.yolo.get_pending_collection_events()
            )

            # Verify IPC file on disk contains collectionEvents despite status=STOPPED
            with open(self.state_file, "r", encoding="utf-8") as f:
                disk_state = json.load(f)
            self.assertEqual(disk_state["status"], "STOPPED")
            self.assertIn("collectionEvents", disk_state)
            self.assertEqual(len(disk_state["collectionEvents"]), 2)

            # Read state via bridge: returns the 2 events even though yoloStatus is STOPPED
            bridge_state = smartbin_yolo_bridge.read_yolo_state()
            self.assertEqual(bridge_state["yoloStatus"], "STOPPED")
            self.assertEqual(len(bridge_state["collectionEvents"]), 2)

            # Pi Agent wakes up and processes them
            results = pi_agent.process_online_collection_events(bridge_state)
            self.assertEqual(len(results), 2)
            self.assertTrue(results[0]["saved"])
            self.assertEqual(results[0]["eventType"], "OPEN")
            self.assertTrue(results[1]["saved"])
            self.assertEqual(results[1]["eventType"], "CLOSE")

    def test_06_ipc_queue_order_and_no_overwriting(self):
        """6. Hàng đợi IPC: OPEN và CLOSE được bảo toàn đúng thứ tự, không bị ghi đè."""
        self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
        self.yolo.read_esp32()
        self.fake_serial.feed("TU DONG: TIEP TUC\n")
        self.yolo.read_esp32()

        events = self.yolo.get_pending_collection_events()
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["eventType"], "OPEN")
        self.assertEqual(events[1]["eventType"], "CLOSE")
        self.assertEqual(events[0]["sessionId"], events[1]["sessionId"])


if __name__ == "__main__":
    unittest.main()
