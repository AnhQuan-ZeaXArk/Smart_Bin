#!/usr/bin/env python3
"""
Unit and Integration Tests for Station A Online Manual Collection History (Phase 1.1):
1. Mở khi đang kết nối -> Backend ACK -> lưu thành công
2. Đóng sau khi đã mở -> dùng lại đúng sessionId, Backend ACK -> lưu thành công
3. Nhận 2 thông báo mở liên tiếp -> chỉ 1 phiên mở
4. Nhận thông báo đóng khi chưa mở -> bị bỏ qua
5. Mất kết nối với Backend -> không lưu sự kiện (không ghi vào SQLite hay file hàng đợi)
6. Kết nối lại với Backend -> sự kiện cũ không được gửi bù
7. Backend trả ACK thất bại -> sự kiện không được tính là đã lưu, sự kiện đóng tiếp theo không được gửi như phiên hợp lệ
8. Không nhận nhầm Servo 1: MO hoặc lệnh servo tự động của YOLO
9. HC1, HC2, HC3 và Trạm B vẫn hoạt động bình thường
"""

import importlib.util
import json
import os
import sys
import tempfile
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


def load_yolo_camera_module():
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
        f"smartbin_test_yolo_collection_{uuid.uuid4().hex}",
        DEVICE_DIR / "yolo_camera.py",
    )
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, fake_modules):
        spec.loader.exec_module(module)
    return module, serial_mod


class FakeSerialPort:
    """Controllable serial stream for testing line and chunk parsing."""

    def __init__(self):
        self._buffer = b""
        self.written = []
        self.is_open = True

    def feed(self, text_or_bytes):
        if isinstance(text_or_bytes, str):
            self._buffer += text_or_bytes.encode("utf-8")
        else:
            self._buffer += text_or_bytes

    @property
    def in_waiting(self):
        return len(self._buffer)

    def read(self, size=1):
        chunk = self._buffer[:size]
        self._buffer = self._buffer[size:]
        return chunk

    def write(self, data):
        self.written.append(data.decode("utf-8", errors="ignore"))

    def flush(self):
        pass


class FakeSocketIOClient:
    """Controllable Socket.IO mock supporting callback ACKs."""

    def __init__(self, connected=True, ack_handler=None):
        self.connected = connected
        self.emitted = []
        self.ack_handler = ack_handler

    def emit(self, event, payload, callback=None):
        self.emitted.append((event, payload))
        if callback is not None:
            if callable(self.ack_handler):
                resp = self.ack_handler(event, payload)
                callback(resp)
            else:
                callback(
                    {
                        "success": True,
                        "status": "SAVED",
                        "eventId": payload.get("eventId") if isinstance(payload, dict) else None,
                        "sessionId": payload.get("sessionId") if isinstance(payload, dict) else None,
                    }
                )


def make_box(confidence, class_id=0):
    return types.SimpleNamespace(conf=[confidence], cls=[class_id])


def make_result(boxes, names=None):
    return types.SimpleNamespace(
        boxes=boxes,
        names=names or {0: "taiche", 1: "khongtaiche", 2: "huuco"},
        plot=mock.Mock(return_value="annotated frame"),
    )


class TestStationACollectionEvents(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state_file = os.path.join(self.temp_dir.name, "yolo_state.json")
        self.ack_file = os.path.join(self.temp_dir.name, "backend_ack.json")
        self.state_patcher = mock.patch.object(
            smartbin_yolo_bridge, "STATE_FILE_PATH", self.state_file
        )
        self.ack_patcher = mock.patch.object(
            smartbin_yolo_bridge, "BACKEND_ACK_FILE_PATH", self.ack_file
        )
        self.state_patcher.start()
        self.ack_patcher.start()

        self.yolo, self.serial_mod = load_yolo_camera_module()
        self.fake_serial = FakeSerialPort()
        self.yolo.esp32 = self.fake_serial
        self.yolo._serial_buffer = ""
        self.yolo.sensor_state = {"hc1": None, "hc2": None, "hc3": None}
        self.yolo.reset_collection_session_state()
        smartbin_yolo_bridge.reset_backend_ack_state()
        pi_agent.reset_online_collection_state()

    def tearDown(self):
        self.ack_patcher.stop()
        self.state_patcher.stop()
        self.temp_dir.cleanup()

    def _publish_current_yolo_ipc(self):
        self.yolo._publish_state_safely(
            detection=None,
            status="RUNNING",
            camera="CONNECTED",
            sensors=self.yolo.get_live_sensors(),
        )

    def test_01_open_when_connected_backend_ack_saves_successfully(self):
        """1. Mở khi đang kết nối -> Backend ACK -> lưu thành công."""
        fake_sio = FakeSocketIOClient(connected=True)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            results = pi_agent.process_online_collection_events()
            self.assertEqual(len(results), 1)
            res = results[0]
            self.assertTrue(res["saved"])
            self.assertEqual(res["eventType"], "OPEN")

            self.assertEqual(len(fake_sio.emitted), 1)
            event_name, payload = fake_sio.emitted[0]
            self.assertEqual(event_name, "device:collection:event")
            self.assertEqual(
                set(payload.keys()),
                {"eventId", "sessionId", "stationId", "triggerSource", "eventType", "occurredAt"},
            )
            self.assertEqual(payload["stationId"], "station_a")
            self.assertEqual(payload["triggerSource"], "PHYSICAL_BUTTON")
            self.assertEqual(payload["eventType"], "OPEN")
            self.assertEqual(str(uuid.UUID(payload["eventId"])), payload["eventId"])
            self.assertEqual(str(uuid.UUID(payload["sessionId"])), payload["sessionId"])
            self.assertIn(payload["sessionId"], pi_agent._confirmed_open_sessions)

    def test_02_close_after_open_reuses_session_id_and_backend_ack_saves(self):
        """2. Đóng sau khi đã mở -> dùng lại đúng sessionId, Backend ACK -> lưu thành công."""
        fake_sio = FakeSocketIOClient(connected=True)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            # Step 1: Open
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()
            open_results = pi_agent.process_online_collection_events()
            self.assertEqual(len(open_results), 1)
            open_session_id = open_results[0]["sessionId"]

            # Step 2: Close
            self.fake_serial.feed("TU DONG: TIEP TUC\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()
            close_results = pi_agent.process_online_collection_events()

            self.assertEqual(len(close_results), 1)
            close_res = close_results[0]
            self.assertTrue(close_res["saved"])
            self.assertEqual(close_res["eventType"], "CLOSE")
            self.assertEqual(close_res["sessionId"], open_session_id)
            self.assertNotEqual(close_res["eventId"], open_results[0]["eventId"])
            self.assertNotIn(open_session_id, pi_agent._confirmed_open_sessions)

    def test_03_duplicate_open_messages_create_only_one_open_session(self):
        """3. Nhận 2 thông báo mở liên tiếp -> chỉ 1 phiên mở."""
        fake_sio = FakeSocketIOClient(connected=True)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed(
                "THU CONG: MO CA 3 SERVO (330 do)\n"
                "THU CONG: MO CA 3 SERVO (330 do)\n"
                "THU CONG: MO CA 3 SERVO (330 do)\n"
            )
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            results = pi_agent.process_online_collection_events()
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["eventType"], "OPEN")
            self.assertEqual(len(fake_sio.emitted), 1)

    def test_04_close_message_when_not_open_is_ignored(self):
        """4. Nhận thông báo đóng khi chưa mở -> bị bỏ qua."""
        fake_sio = FakeSocketIOClient(connected=True)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed("TU DONG: TIEP TUC\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            results = pi_agent.process_online_collection_events()
            self.assertEqual(results, [])
            self.assertEqual(fake_sio.emitted, [])

    def test_05_disconnected_from_backend_does_not_save_or_queue_offline(self):
        """5. Mất kết nối với Backend -> không lưu sự kiện và không tạo hàng đợi ngoại tuyến."""
        fake_sio = FakeSocketIOClient(connected=False)
        fake_buffer = mock.Mock()
        with mock.patch.object(pi_agent, "sio", fake_sio), mock.patch.object(
            pi_agent, "offline_buffer", fake_buffer
        ):
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            results = pi_agent.process_online_collection_events()
            self.assertEqual(len(results), 1)
            self.assertFalse(results[0]["saved"])
            self.assertEqual(results[0]["reason"], "OFFLINE")
            self.assertEqual(fake_sio.emitted, [])
            fake_buffer.enqueue.assert_not_called()

            # Verify no persistent queue files (.events.json or sqlite) were created on disk
            self.assertFalse(any(f.endswith(".events.json") for f in os.listdir(self.temp_dir.name)))

    def test_06_reconnect_to_backend_does_not_replay_old_offline_events(self):
        """6. Kết nối lại với Backend -> sự kiện cũ lúc mất kết nối không được gửi bù."""
        fake_sio = FakeSocketIOClient(connected=False)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            # Event occurs while offline
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            offline_results = pi_agent.process_online_collection_events()
            self.assertEqual(len(offline_results), 1)
            self.assertFalse(offline_results[0]["saved"])
            self.assertEqual(fake_sio.emitted, [])

            # Backend reconnects later; IPC snapshot still has the old event
            fake_sio.connected = True
            reconnect_results = pi_agent.process_online_collection_events()
            self.assertEqual(reconnect_results, [])
            self.assertEqual(fake_sio.emitted, [])

            # Even if CLOSE arrives after reconnect for that unconfirmed offline OPEN,
            # CLOSE must NOT be sent to Backend as if the session were recorded
            self.fake_serial.feed("TU DONG: TIEP TUC\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()
            close_results = pi_agent.process_online_collection_events()
            self.assertEqual(len(close_results), 1)
            self.assertFalse(close_results[0]["saved"])
            self.assertEqual(close_results[0]["reason"], "OPEN_NOT_CONFIRMED")
            self.assertEqual(fake_sio.emitted, [])

    def test_07_backend_failed_ack_does_not_mark_saved_and_blocks_subsequent_close(self):
        """7. Backend trả ACK thất bại -> sự kiện không được tính là đã lưu."""
        fake_sio = FakeSocketIOClient(
            connected=True,
            ack_handler=lambda _ev, payload: {
                "success": False,
                "status": "INGESTION_ERROR",
                "eventId": payload.get("eventId"),
            },
        )
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            open_results = pi_agent.process_online_collection_events()
            self.assertEqual(len(open_results), 1)
            self.assertFalse(open_results[0]["saved"])
            self.assertEqual(open_results[0]["reason"], "ACK_FAILED")
            self.assertEqual(len(pi_agent._confirmed_open_sessions), 0)

            # Now even if Backend recovers, a CLOSE for that failed OPEN session is not emitted
            fake_sio.ack_handler = None
            fake_sio.emitted.clear()
            self.fake_serial.feed("TU DONG: TIEP TUC\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            close_results = pi_agent.process_online_collection_events()
            self.assertEqual(len(close_results), 1)
            self.assertFalse(close_results[0]["saved"])
            self.assertEqual(close_results[0]["reason"], "OPEN_NOT_CONFIRMED")
            self.assertEqual(fake_sio.emitted, [])

    def test_08_ignores_servo_1_mo_and_automatic_yolo_servo_commands(self):
        """8. Không nhận nhầm Servo 1: MO hoặc lệnh servo tự động của YOLO."""
        self.yolo.servo_armed = True
        self.yolo.last_detection_time = 0

        detection = self.yolo.process_detection(make_result([make_box(0.93, 0)]))
        self.assertIsNotNone(detection)
        self.assertEqual(self.fake_serial.written, ["taiche\n"])

        self.fake_serial.feed(
            "taiche\n"
            "Servo 1: MO (330 do)\n"
            "Servo 2: MO (330 do)\n"
            "Servo 3: MO (330 do)\n"
            "Servo 1: DONG (150 do)\n"
            "Servo 2: DONG (150 do)\n"
            "Servo 3: DONG (150 do)\n"
            "TU CHOI: Thung 1 day/HC1 chua co du lieu\n"
        )
        self.yolo.read_esp32()
        self._publish_current_yolo_ipc()

        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state["collectionEvents"], [])
        self.assertFalse(self.yolo.collection_session_open)

    def test_09_hc1_hc2_hc3_and_station_b_continue_working_normally(self):
        """9. HC1, HC2, HC3 và Trạm B vẫn hoạt động bình thường."""
        self.fake_serial.feed(
            "HC1: 45%\n"
            "THU CONG: MO CA 3 SERVO (330 do)\n"
            "HC2: 62%\n"
            "TU DONG: TIEP TUC\n"
            "HC3: 28%\n"
        )
        self.yolo.read_esp32()
        self._publish_current_yolo_ipc()

        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state["yoloStatus"], "RUNNING")
        self.assertEqual(state["sensors"]["hc1"]["fillPercent"], 45)
        self.assertEqual(state["sensors"]["hc2"]["fillPercent"], 62)
        self.assertEqual(state["sensors"]["hc3"]["fillPercent"], 28)
        self.assertEqual(len(state["collectionEvents"]), 2)

        # Verify Station A and Station B telemetry in pi_agent.send_telemetry()
        fake_sio = FakeSocketIOClient(connected=True)
        fake_station_b = mock.Mock()
        fake_station_b.get_latest_data.return_value = {
            "stationCode": "STATION_B",
            "deviceId": "esp32c6-station-b",
            "uptimeMs": 12000,
            "bootCount": 1,
            "sampleSeq": 7,
            "bootId": "boot-b1",
            "sensors": {
                "recyclable": {"fillPercent": 54, "status": "OK"},
                "nonRecyclable": {"fillPercent": None, "status": "NOT_INSTALLED"},
                "organic": {"fillPercent": None, "status": "NOT_INSTALLED"},
            },
        }

        with mock.patch.object(pi_agent, "sio", fake_sio), mock.patch.object(
            pi_agent, "station_b_worker", fake_station_b
        ):
            ok = pi_agent.send_telemetry()
            self.assertTrue(ok)

        emitted_events = [ev for ev, _ in fake_sio.emitted]
        self.assertIn("device:collection:event", emitted_events)
        self.assertIn("device:telemetry", emitted_events)

        telemetry_payloads = [p for ev, p in fake_sio.emitted if ev == "device:telemetry"]
        self.assertEqual(len(telemetry_payloads), 2)
        station_a_payload = next(p for p in telemetry_payloads if p["stationCode"] == "STATION_A")
        station_b_payload = next(p for p in telemetry_payloads if p["stationCode"] == "STATION_B")

        self.assertEqual(station_a_payload["sensors"]["recyclable"]["fillLevel"], 45)
        self.assertEqual(station_a_payload["sensors"]["nonRecyclable"]["fillLevel"], 62)
        self.assertEqual(station_a_payload["sensors"]["organic"]["fillLevel"], 28)
        self.assertEqual(station_b_payload["sensors"]["recyclable"]["fillLevel"], 54)
        self.assertIsNone(station_b_payload["sensors"]["nonRecyclable"]["fillLevel"])

    def test_10_pi_agent_restart_when_yolo_running_does_not_resend_acked_event(self):
        """10. Pi Agent khởi động lại khi YOLO vẫn chạy: không gửi lại sự kiện đã nhận Backend ACK."""
        fake_sio = FakeSocketIOClient(connected=True)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            # First run: event is sent and receives Backend ACK
            results = pi_agent.process_online_collection_events()
            self.assertEqual(len(results), 1)
            self.assertTrue(results[0]["saved"])
            self.assertEqual(len(fake_sio.emitted), 1)
            open_ev_id = results[0]["eventId"]

            # Simulate Pi Agent restart: RAM wiped clean, but reloading from bridge
            pi_agent._seen_collection_event_ids.clear()
            pi_agent._confirmed_open_sessions.clear()
            pi_agent.reset_online_collection_state()

            # Verify that read_yolo_state filters out the acked event
            ipc_state = smartbin_yolo_bridge.read_yolo_state()
            self.assertEqual(ipc_state["collectionEvents"], [])

            # Pi Agent runs again after restart: must NOT emit any event!
            fake_sio.emitted.clear()
            restart_results = pi_agent.process_online_collection_events()
            self.assertEqual(restart_results, [])
            self.assertEqual(fake_sio.emitted, [])

    def test_11_event_cleared_from_ipc_after_backend_ack(self):
        """11. Sau khi nhận được Backend ACK thành công, sự kiện được loại khỏi danh sách truyền trong IPC."""
        fake_sio = FakeSocketIOClient(connected=True)
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            # Before ACK: IPC has 1 event
            before_state = smartbin_yolo_bridge.read_yolo_state()
            self.assertEqual(len(before_state["collectionEvents"]), 1)

            # Send and receive Backend ACK
            results = pi_agent.process_online_collection_events()
            self.assertEqual(len(results), 1)
            self.assertTrue(results[0]["saved"])

            # Immediately after Backend ACK: read_yolo_state filters it out
            after_state = smartbin_yolo_bridge.read_yolo_state()
            self.assertEqual(after_state["collectionEvents"], [])

            # Next YOLO publish tick purges internal pending list and disk file
            self._publish_current_yolo_ipc()
            self.assertEqual(self.yolo._pending_collection_events, [])
            with open(self.state_file, "r", encoding="utf-8") as f:
                raw_disk_data = json.load(f)
            self.assertNotIn("collectionEvents", raw_disk_data)

    def test_12_backend_failed_ack_does_not_clear_ipc_or_confirm_session(self):
        """12. Backend ACK thất bại: không đánh dấu đã lưu, không loại khỏi IPC, và không xác nhận phiên mở."""
        fake_sio = FakeSocketIOClient(
            connected=True,
            ack_handler=lambda _ev, payload: {
                "success": False,
                "status": "DATABASE_ERROR",
                "eventId": payload.get("eventId"),
            },
        )
        with mock.patch.object(pi_agent, "sio", fake_sio):
            self.fake_serial.feed("THU CONG: MO CA 3 SERVO (330 do)\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            results = pi_agent.process_online_collection_events()
            self.assertEqual(len(results), 1)
            self.assertFalse(results[0]["saved"])
            self.assertEqual(results[0]["reason"], "ACK_FAILED")

            # Backend ACK was NOT recorded
            acked_ids = smartbin_yolo_bridge.get_acknowledged_backend_event_ids()
            self.assertEqual(len(acked_ids), 0)
            self.assertEqual(len(pi_agent._confirmed_open_sessions), 0)

            # CLOSE arriving later must be rejected
            fake_sio.ack_handler = None
            fake_sio.emitted.clear()
            self.fake_serial.feed("TU DONG: TIEP TUC\n")
            self.yolo.read_esp32()
            self._publish_current_yolo_ipc()

            close_results = pi_agent.process_online_collection_events()
            self.assertEqual(len(close_results), 1)
            self.assertFalse(close_results[0]["saved"])
            self.assertEqual(close_results[0]["reason"], "OPEN_NOT_CONFIRMED")
            self.assertEqual(fake_sio.emitted, [])


if __name__ == "__main__":
    unittest.main()
