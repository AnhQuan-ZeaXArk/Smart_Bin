#!/usr/bin/env python3
"""
Unit and Integration Tests for Station A Lid Error Alert Mechanism:
1. Chuoi loi 1 ('loi mo nap') o Che do 1 (Tu dong - Automatic Mode)
2. Chuoi loi 2 ('loi dong nap') o Che do 1 (Tu dong - Automatic Mode)
3. Chuoi loi 1 ('loi mo nap') o Che do 2 (Thu cong - Manual Mode)
4. Chuoi loi 2 ('loi dong nap') o Che do 2 (Thu cong - Manual Mode)
5. Cac dong Serial binh thuong khong kich hoat canh bao (HC1/2/3, Servo, Tu dong, Lux, ...)
6. Tuyen IPC yolo_camera -> smartbin_yolo_bridge (publish_yolo_state -> read_yolo_state)
7. Tuyen Pi Agent telemetry & Socket.IO emit (build_telemetry_payload, send_telemetry)
8. Bao toan tinh toan ven cua cac chuc nang hien co (cam bien HC1-3, collection events, Station B)
"""

import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
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

    with mock.patch.dict(sys.modules, fake_modules):
        spec = importlib.util.spec_from_file_location(
            "yolo_camera_tested",
            DEVICE_DIR / "yolo_camera.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module


yolo_camera = load_yolo_camera_module()


class TestLidErrorAlertDetection(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.state_file = os.path.join(self.tmp_dir.name, "smartbin_yolo_state.json")
        self.ack_file = os.path.join(self.tmp_dir.name, "smartbin_backend_ack.json")

        smartbin_yolo_bridge.STATE_FILE_PATH = self.state_file
        smartbin_yolo_bridge.BACKEND_ACK_FILE_PATH = self.ack_file
        smartbin_yolo_bridge.reset_backend_ack_state()
        pi_agent.reset_online_collection_state()

        yolo_camera.reset_lid_alert_state()
        yolo_camera.reset_collection_session_state()
        yolo_camera.sensor_state = {"hc1": None, "hc2": None, "hc3": None}
        yolo_camera._serial_buffer = ""

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_case_1_error_string_1_in_mode_1_automatic(self):
        """Kiem tra chuoi loi 1 ('loi mo nap') khi dang o Che do 1 (Tu dong)."""
        self.assertFalse(yolo_camera.collection_session_open, "Che do phai la Che do 1 (Tu dong)")
        self.assertFalse(yolo_camera.lid_alert, "Ban dau lid_alert phai la False")

        # Serial tu ESP32 phat chuoi 'loi mo nap'
        handled = yolo_camera.handle_lid_error_line("loi mo nap")
        self.assertTrue(handled)
        self.assertTrue(yolo_camera.lid_alert, "lid_alert phai chuyen sang True khi gap 'loi mo nap'")
        self.assertEqual(yolo_camera.last_lid_error, "loi mo nap")
        self.assertFalse(yolo_camera.collection_session_open, "Che do van phai la Tu dong")

    def test_case_2_error_string_2_in_mode_1_automatic(self):
        """Kiem tra chuoi loi 2 ('loi dong nap') khi dang o Che do 1 (Tu dong)."""
        self.assertFalse(yolo_camera.collection_session_open, "Che do phai la Che do 1 (Tu dong)")
        self.assertFalse(yolo_camera.lid_alert, "Ban dau lid_alert phai la False")

        # Serial tu ESP32 phat chuoi 'loi dong nap'
        handled = yolo_camera.handle_lid_error_line("loi dong nap")
        self.assertTrue(handled)
        self.assertTrue(yolo_camera.lid_alert, "lid_alert phai chuyen sang True khi gap 'loi dong nap'")
        self.assertEqual(yolo_camera.last_lid_error, "loi dong nap")
        self.assertFalse(yolo_camera.collection_session_open, "Che do van phai la Tu dong")

    def test_case_3_error_string_1_in_mode_2_manual(self):
        """Kiem tra chuoi loi 1 ('loi mo nap') khi dang o Che do 2 (Thu cong - sau khi mo 3 thung)."""
        # Nhan nut vat ly -> ESP32 phat thong bao mo thu cong
        open_event = yolo_camera.handle_collection_serial_line("THU CONG: MO CA 3 SERVO (330 do)")
        self.assertIsNotNone(open_event)
        self.assertTrue(yolo_camera.collection_session_open, "Che do phai la Che do 2 (Thu cong)")

        # Phat chuoi 'loi mo nap' trong Che do 2
        handled = yolo_camera.handle_lid_error_line("loi mo nap")
        self.assertTrue(handled)
        self.assertTrue(yolo_camera.lid_alert, "lid_alert phai chuyen sang True o Che do 2")
        self.assertTrue(yolo_camera.collection_session_open, "Phien thu cong van phai giu nguyen trang thai mo")

    def test_case_4_error_string_2_in_mode_2_manual(self):
        """Kiem tra chuoi loi 2 ('loi dong nap') khi dang o Che do 2 (Thu cong)."""
        open_event = yolo_camera.handle_collection_serial_line("THU CONG: MO CA 3 SERVO (330 do)")
        self.assertIsNotNone(open_event)
        self.assertTrue(yolo_camera.collection_session_open, "Che do phai la Che do 2 (Thu cong)")

        # Phat chuoi 'loi dong nap' trong Che do 2
        handled = yolo_camera.handle_lid_error_line("loi dong nap")
        self.assertTrue(handled)
        self.assertTrue(yolo_camera.lid_alert, "lid_alert phai chuyen sang True o Che do 2")
        self.assertTrue(yolo_camera.collection_session_open, "Phien thu cong van phai giu nguyen")

    def test_case_5_normal_serial_lines_do_not_trigger_lid_alert(self):
        """Kiem tra cac dong Serial thong thuong (khong chua chuoi loi nap) khong kich hoat canh bao."""
        normal_lines = [
            "HC1: 45%",
            "HC2: 60%",
            "HC3: 30%",
            "Servo 1: MO (330 do)",
            "Servo 2: MO (330 do)",
            "Servo 3: MO (330 do)",
            "Servo 1: DONG (150 do)",
            "Servo 2: DONG (150 do)",
            "Servo 3: DONG (150 do)",
            "TU CHOI: Thung 1 day/HC1 chua co du lieu",
            "BH1750: OK",
            "Lux: 250.5",
            "taiche",
            "khongtaiche",
            "huuco",
            "THU CONG: MO CA 3 SERVO (330 do)",
            "TU DONG: TIEP TUC"
        ]

        for line in normal_lines:
            handled = yolo_camera.handle_lid_error_line(line)
            self.assertFalse(handled, f"Dong thong thuong '{line}' khong duoc nhan nham la loi nap")
            self.assertFalse(yolo_camera.lid_alert, f"Dong '{line}' khong duoc set lid_alert=True")

    def test_case_6_ipc_pipeline_publish_and_read(self):
        """Kiem tra dong bo trang thai lidAlert qua IPC file tmpfs."""
        # 1. Publish state co lid_alert=True
        success = smartbin_yolo_bridge.publish_yolo_state(
            status="RUNNING",
            camera="CONNECTED",
            lid_alert=True
        )
        self.assertTrue(success)

        read_state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(read_state["yoloStatus"], "RUNNING")
        self.assertEqual(read_state["cameraStatus"], "CONNECTED")
        self.assertTrue(read_state["lidAlert"], "IPC read_yolo_state phai tra ve lidAlert=True")

        # 2. Publish state co lid_alert=False
        success_false = smartbin_yolo_bridge.publish_yolo_state(
            status="RUNNING",
            camera="CONNECTED",
            lid_alert=False
        )
        self.assertTrue(success_false)
        read_state_false = smartbin_yolo_bridge.read_yolo_state()
        self.assertFalse(read_state_false["lidAlert"], "IPC read_yolo_state phai tra ve lidAlert=False")

    def test_case_7_pi_agent_telemetry_and_socket_alert(self):
        """Kiem tra Pi Agent doc lidAlert tu IPC va phat lenh telemetry/socket alert."""
        # Gia lap IPC chua lidAlert=True
        smartbin_yolo_bridge.publish_yolo_state(
            status="RUNNING",
            camera="CONNECTED",
            lid_alert=True
        )

        with mock.patch("pi_agent.read_yolo_state", smartbin_yolo_bridge.read_yolo_state):
            payload = pi_agent.build_telemetry_payload()
            self.assertTrue(payload.get("lidAlert"), "Telemetry payload phai mang lidAlert=True")
            self.assertTrue(payload.get("metadata", {}).get("lidAlert"), "Metadata phai chua lidAlert=True")

            # Test phat socket event device:lid:alert trong send_telemetry
            mock_sio = mock.MagicMock()
            mock_sio.connected = True

            emitted_events = []
            def fake_emit(event, data, callback=None):
                emitted_events.append((event, data))
                if callback:
                    callback({"success": True, "status": "COMMITTED"})

            mock_sio.emit.side_effect = fake_emit

            with mock.patch("pi_agent.sio", mock_sio):
                pi_agent.send_telemetry()

                # Kiem tra da phat su kien 'device:lid:alert'
                lid_alert_emits = [e for e in emitted_events if e[0] == "device:lid:alert"]
                self.assertTrue(len(lid_alert_emits) >= 1, "Phai phat su kien 'device:lid:alert'")
                event_name, event_data = lid_alert_emits[0]
                self.assertEqual(event_data.get("message"), "CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!")
                self.assertTrue(event_data.get("lidAlert"))
                # Khong hien thi thong tin thung rieng biet
                self.assertNotIn("binCode", event_data)
                self.assertNotIn("binName", event_data)
                self.assertNotIn("binIndex", event_data)

    def test_case_8_preserves_sensor_readings_and_collection(self):
        """Kiem tra cam bien va su kien thu gom khong bi anh huong khi phat hien loi nap."""
        # 1. Cap nhat cam bien
        yolo_camera._serial_buffer = "HC1: 45%\nloi mo nap\nHC2: 62%\n"
        mock_serial = mock.Mock()
        mock_serial.in_waiting = 0
        yolo_camera.esp32 = mock_serial

        # Doc phan hoi
        yolo_camera.read_esp32()
        self.assertTrue(yolo_camera.lid_alert, "Loi nap phai duoc ghi nhan")
        self.assertEqual(yolo_camera.sensor_state["hc1"]["fillPercent"], 45, "HC1 van duoc cap nhat dung 45%")
        self.assertEqual(yolo_camera.sensor_state["hc2"]["fillPercent"], 62, "HC2 van duoc cap nhat dung 62%")

        live_sensors = yolo_camera.get_live_sensors()
        self.assertIsNotNone(live_sensors)
        self.assertEqual(live_sensors["hc1"]["fillPercent"], 45)
        self.assertEqual(live_sensors["hc2"]["fillPercent"], 62)

    def test_case_9_no_duplicate_lid_alert_emits_across_multiple_telemetry_cycles(self):
        """Kiem tra send_telemetry khong phat trung lap nhieu su kien device:lid:alert qua Socket.IO."""
        smartbin_yolo_bridge.publish_yolo_state(
            status="RUNNING",
            camera="CONNECTED",
            lid_alert=True
        )

        mock_sio = mock.MagicMock()
        mock_sio.connected = True

        emitted_events = []
        def fake_emit(event, data, callback=None):
            emitted_events.append((event, data))
            if callback:
                callback({"success": True, "status": "COMMITTED"})

        mock_sio.emit.side_effect = fake_emit

        with mock.patch("pi_agent.read_yolo_state", smartbin_yolo_bridge.read_yolo_state), \
             mock.patch("pi_agent.sio", mock_sio):
            # Goi send_telemetry lan 1
            pi_agent.send_telemetry()
            # Goi send_telemetry lan 2 (chu ky telemetry tiep theo)
            pi_agent.send_telemetry()
            # Goi send_telemetry lan 3 (chu ky telemetry tiep theo)
            pi_agent.send_telemetry()

            lid_alert_emits = [e for e in emitted_events if e[0] == "device:lid:alert"]
            self.assertEqual(len(lid_alert_emits), 1, "Chi phat device:lid:alert duy nhat 1 lan, khong spam lap lai")

            # Tuy nhien tat ca cac goi telemetry deu mang lidAlert: True
            telemetry_emits = [e for e in emitted_events if e[0] == "device:telemetry"]
            self.assertEqual(len(telemetry_emits), 3)
            for _, payload in telemetry_emits:
                self.assertTrue(payload.get("lidAlert"), "Moi goi telemetry deu phai giu nguyen co lidAlert=True")

    def test_case_10_persistent_alert_when_esp32_sends_normal_sensor_afterwards(self):
        """Kiem tra canh bao khong tu bien mat khi ESP32 gui cac dong cam bien binh thuong tiep theo."""
        # 1. Phat loi nap
        yolo_camera.handle_lid_error_line("loi mo nap")
        self.assertTrue(yolo_camera.lid_alert)

        # 2. ESP32 gui tiep tuc 10 goi cam bien binh thuong
        normal_lines = [f"HC1: {i}%" for i in range(10, 20)]
        for line in normal_lines:
            yolo_camera._serial_buffer = line + "\n"
            mock_serial = mock.Mock()
            mock_serial.in_waiting = 0
            yolo_camera.esp32 = mock_serial
            yolo_camera.read_esp32()
            self.assertTrue(yolo_camera.lid_alert, f"Canh bao phai duoc duy tri sau dong: {line}")
        self.assertEqual(yolo_camera.sensor_state["hc1"]["fillPercent"], 19)

    def test_case_11_serial_control_chars_and_socket_reconnect_resync(self):
        """Kiem tra loc ky tu dieu khien USB Serial va phat lai su kien khi Socket.IO ket noi lai."""
        handled = yolo_camera.handle_lid_error_line("\x00\rloi mo nap\r\n")
        self.assertTrue(handled)
        self.assertTrue(yolo_camera.lid_alert)

        smartbin_yolo_bridge.publish_yolo_state(
            status="RUNNING",
            camera="CONNECTED",
            lid_alert=True
        )

        mock_sio = mock.MagicMock()
        mock_sio.connected = True
        emitted_events = []
        mock_sio.emit.side_effect = lambda ev, data, callback=None: (
            emitted_events.append((ev, data)),
            callback({"success": True, "status": "COMMITTED"}) if callback else None
        )

        with mock.patch("pi_agent.read_yolo_state", smartbin_yolo_bridge.read_yolo_state), \
             mock.patch("pi_agent.sio", mock_sio):
            pi_agent.send_telemetry()
            self.assertEqual(len([e for e in emitted_events if e[0] == "device:lid:alert"]), 1)

            # Gia lap mat ket noi Socket.IO roi ket noi lai
            pi_agent.disconnect()
            self.assertFalse(pi_agent._lid_alert_emitted)

            pi_agent.send_telemetry()
            self.assertEqual(
                len([e for e in emitted_events if e[0] == "device:lid:alert"]),
                2,
                "Sau khi disconnect va ket noi lai, Pi Agent phai dong bo lai device:lid:alert"
            )

    def test_case_12_infinite_retrigger_cycle_across_consecutive_lid_errors(self):
        """Kiem tra chu trinh lap vo han: Moi loi nap moi deu tao eventId rieng va phat lai device:lid:alert."""
        yolo_camera.reset_lid_alert_state()
        pi_agent.reset_online_collection_state()

        mock_sio = mock.MagicMock()
        mock_sio.connected = True
        emitted_events = []
        mock_sio.emit.side_effect = lambda ev, data, callback=None: (
            emitted_events.append((ev, data)),
            callback({"success": True, "status": "COMMITTED"}) if callback else None
        )

        with mock.patch("pi_agent.read_yolo_state", smartbin_yolo_bridge.read_yolo_state), \
             mock.patch("pi_agent.sio", mock_sio):

            # === CHU TRINH 1: Loi mo nap lan 1 ===
            yolo_camera.handle_lid_error_line("loi mo nap")
            self.assertTrue(yolo_camera.lid_alert)
            ev1_id = yolo_camera.last_lid_error_id
            self.assertTrue(ev1_id.startswith("lid-error-001-"))

            # Telemetry tick 1 -> phat device:lid:alert lan 1
            pi_agent.send_telemetry()
            lid_emits = [e for e in emitted_events if e[0] == "device:lid:alert"]
            self.assertEqual(len(lid_emits), 1)
            self.assertEqual(lid_emits[0][1]["eventId"], ev1_id)

            # Telemetry tick 2, 3 (dinh ky) -> KHONG phat lai device:lid:alert
            pi_agent.send_telemetry()
            pi_agent.send_telemetry()
            lid_emits = [e for e in emitted_events if e[0] == "device:lid:alert"]
            self.assertEqual(len(lid_emits), 1, "Telemetry dinh ky khong duoc spam emit")

            # === CHU TRINH 2: Loi dong nap lan 2 (sau do vai chuc giay hoac vai phut) ===
            yolo_camera.handle_lid_error_line("loi dong nap")
            self.assertTrue(yolo_camera.lid_alert)
            ev2_id = yolo_camera.last_lid_error_id
            self.assertTrue(ev2_id.startswith("lid-error-002-"))
            self.assertNotEqual(ev1_id, ev2_id)

            # Telemetry tick -> phat device:lid:alert lan 2
            pi_agent.send_telemetry()
            lid_emits = [e for e in emitted_events if e[0] == "device:lid:alert"]
            self.assertEqual(len(lid_emits), 2, "Loi dong nap moi phai kich hoat device:lid:alert lan 2")
            self.assertEqual(lid_emits[1][1]["eventId"], ev2_id)

            # Telemetry tick tiep theo -> KHONG spam
            pi_agent.send_telemetry()
            lid_emits = [e for e in emitted_events if e[0] == "device:lid:alert"]
            self.assertEqual(len(lid_emits), 2)

            # === CHU TRINH 3: Loi mo nap lan 3 (lap vo han) ===
            yolo_camera.handle_lid_error_line("loi mo nap")
            ev3_id = yolo_camera.last_lid_error_id
            self.assertTrue(ev3_id.startswith("lid-error-003-"))

            # Telemetry tick -> phat device:lid:alert lan 3
            pi_agent.send_telemetry()
            lid_emits = [e for e in emitted_events if e[0] == "device:lid:alert"]
            self.assertEqual(len(lid_emits), 3, "Loi tiep theo phai tai kich hoat device:lid:alert lan 3")
            self.assertEqual(lid_emits[2][1]["eventId"], ev3_id)

            # Toan bo 6 goi telemetry deu duy tri co lidAlert: True
            telemetry_emits = [e for e in emitted_events if e[0] == "device:telemetry"]
            self.assertEqual(len(telemetry_emits), 6)
            for _, payload in telemetry_emits:
                self.assertTrue(payload.get("lidAlert"))


if __name__ == "__main__":
    unittest.main()

