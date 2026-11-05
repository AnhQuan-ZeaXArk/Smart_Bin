#!/usr/bin/env python3
"""
Unit and Integration Tests for Stage 4.3:
ESP32 Ultrasonic Telemetry via USB Serial and YOLO IPC
- Serial parser: HC1/HC2/HC3, boundary [0, 100], partial chunks, multiple lines, non-sensor lines, freshness
- IPC Bridge: Atomic writes, schema backward compatibility, independent sensor freshness, error tolerance
- Pi Agent: Reads sensor data from IPC only, maps to backend contract, omits stale/missing, no pyserial access
"""

import importlib.util
import json
import os
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest import mock

DEVICE_DIR = Path(__file__).resolve().parent
if str(DEVICE_DIR) not in sys.path:
    sys.path.insert(0, str(DEVICE_DIR))

import pi_agent
import smartbin_yolo_bridge


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
        "ultralytics": ultralytics
    }
    spec = importlib.util.spec_from_file_location(
        "smartbin_test_yolo_camera_stage43",
        DEVICE_DIR / "yolo_camera.py"
    )
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, fake_modules):
        spec.loader.exec_module(module)
    return module, serial_mod


class FakeSerialPort:
    """Mock serial stream with controllable buffer for partial chunk tests."""
    def __init__(self):
        self._buffer = b""
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


class TestESP32SerialUltrasonicParser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.yolo, cls.serial_mod = load_yolo_camera_module()

    def setUp(self):
        self.fake_serial = FakeSerialPort()
        self.yolo.esp32 = self.fake_serial
        self.yolo._serial_buffer = ""
        self.yolo.sensor_state = {
            "hc1": None,
            "hc2": None,
            "hc3": None
        }

    def test_hc1_valid_line(self):
        self.fake_serial.feed("HC1: 10%\n")
        self.yolo.read_esp32()
        hc1 = self.yolo.sensor_state["hc1"]
        self.assertIsNotNone(hc1)
        self.assertEqual(hc1["fillPercent"], 10)
        self.assertIsInstance(hc1["updatedAtEpoch"], float)
        self.assertIsNone(self.yolo.sensor_state["hc2"])
        self.assertIsNone(self.yolo.sensor_state["hc3"])

    def test_hc2_valid_line(self):
        self.fake_serial.feed("HC2: 25%\n")
        self.yolo.read_esp32()
        hc2 = self.yolo.sensor_state["hc2"]
        self.assertIsNotNone(hc2)
        self.assertEqual(hc2["fillPercent"], 25)

    def test_hc3_valid_line(self):
        self.fake_serial.feed("HC3: 40%\n")
        self.yolo.read_esp32()
        hc3 = self.yolo.sensor_state["hc3"]
        self.assertIsNotNone(hc3)
        self.assertEqual(hc3["fillPercent"], 40)

    def test_boundary_zero_and_hundred(self):
        self.fake_serial.feed("HC1: 0%\nHC2: 100%\n")
        self.yolo.read_esp32()
        self.assertEqual(self.yolo.sensor_state["hc1"]["fillPercent"], 0)
        self.assertEqual(self.yolo.sensor_state["hc2"]["fillPercent"], 100)

    def test_out_of_range_and_negative_ignored(self):
        self.fake_serial.feed("HC1: -5%\nHC2: 101%\nHC3: 200%\n")
        self.yolo.read_esp32()
        self.assertIsNone(self.yolo.sensor_state["hc1"])
        self.assertIsNone(self.yolo.sensor_state["hc2"])
        self.assertIsNone(self.yolo.sensor_state["hc3"])

    def test_malformed_lines_ignored(self):
        malformed = [
            "HC1: abc%\n",
            "HC4: 10%\n",
            "HC1 10%\n",
            "HC1: 10\n",
            "HC: 10%\n",
            ": 10%\n"
        ]
        for line in malformed:
            self.fake_serial.feed(line)
        self.yolo.read_esp32()
        self.assertIsNone(self.yolo.sensor_state["hc1"])
        self.assertIsNone(self.yolo.sensor_state["hc2"])
        self.assertIsNone(self.yolo.sensor_state["hc3"])

    def test_partial_chunks_split_across_reads(self):
        # Chunk 1: "HC1: 1"
        self.fake_serial.feed("HC1: 1")
        self.yolo.read_esp32()
        self.assertIsNone(self.yolo.sensor_state["hc1"])
        self.assertEqual(self.yolo._serial_buffer, "HC1: 1")

        # Chunk 2: "5%\n"
        self.fake_serial.feed("5%\n")
        self.yolo.read_esp32()
        self.assertIsNotNone(self.yolo.sensor_state["hc1"])
        self.assertEqual(self.yolo.sensor_state["hc1"]["fillPercent"], 15)
        self.assertEqual(self.yolo._serial_buffer, "")

    def test_multiple_lines_in_single_read(self):
        self.fake_serial.feed("HC1: 10%\nHC2: 25%\nHC3: 40%\n")
        self.yolo.read_esp32()
        self.assertEqual(self.yolo.sensor_state["hc1"]["fillPercent"], 10)
        self.assertEqual(self.yolo.sensor_state["hc2"]["fillPercent"], 25)
        self.assertEqual(self.yolo.sensor_state["hc3"]["fillPercent"], 40)

    def test_servo_responses_and_lux_ignored_for_sensors(self):
        lines = (
            "Servo 1: MO (330 do)\n"
            "Servo 1: DONG (150 do)\n"
            "TU CHOI: Thung 1 day/HC1 chua co du lieu\n"
            "BH1750: OK\n"
            "Lux: 12.5\n"
            "HC1: 30%\n"
        )
        self.fake_serial.feed(lines)
        self.yolo.read_esp32()
        self.assertEqual(self.yolo.sensor_state["hc1"]["fillPercent"], 30)
        self.assertIsNone(self.yolo.sensor_state["hc2"])

    def test_one_sensor_stale_while_others_valid(self):
        now = time.time()
        # HC1 received 16 seconds ago (stale > 15s)
        self.yolo.sensor_state["hc1"] = {
            "fillPercent": 50,
            "updatedAtEpoch": now - 16.0
        }
        # HC2 received 2 seconds ago (fresh)
        self.yolo.sensor_state["hc2"] = {
            "fillPercent": 25,
            "updatedAtEpoch": now - 2.0
        }
        # HC3 never received
        self.yolo.sensor_state["hc3"] = None

        live = self.yolo.get_live_sensors()
        self.assertIsNotNone(live)
        self.assertIsNone(live["hc1"], "HC1 older than 15s must be represented as None/stale")
        self.assertIsNotNone(live["hc2"], "HC2 within 15s must remain valid")
        self.assertEqual(live["hc2"]["fillPercent"], 25)
        self.assertIsNone(live["hc3"], "HC3 never received must be None")

    def test_independent_timestamps_not_refreshed_by_unrelated_sensor(self):
        t1 = 1000.0
        with mock.patch("time.time", return_value=t1):
            self.fake_serial.feed("HC1: 10%\n")
            self.yolo.read_esp32()

        t2 = 1005.0
        with mock.patch("time.time", return_value=t2):
            self.fake_serial.feed("HC2: 25%\n")
            self.yolo.read_esp32()

        self.assertEqual(self.yolo.sensor_state["hc1"]["updatedAtEpoch"], t1)
        self.assertEqual(self.yolo.sensor_state["hc2"]["updatedAtEpoch"], t2)


class TestSmartBinYOLOBridgeSensorsIPC(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state_file = os.path.join(self.temp_dir.name, "yolo_state.json")
        self.patcher = mock.patch.object(smartbin_yolo_bridge, "STATE_FILE_PATH", self.state_file)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.temp_dir.cleanup()

    def test_publish_with_sensors_written_atomically(self):
        sensors_input = {
            "hc1": {"fillPercent": 10, "updatedAtEpoch": time.time()},
            "hc2": {"fillPercent": 25, "updatedAtEpoch": time.time() - 2},
            "hc3": None
        }
        detection = {
            "class": "taiche",
            "confidence": 0.95,
            "timestamp": "2026-11-05T00:00:00+00:00"
        }
        success = smartbin_yolo_bridge.publish_yolo_state(
            detection=detection,
            status="RUNNING",
            camera="CONNECTED",
            sensors=sensors_input
        )
        self.assertTrue(success)
        self.assertTrue(os.path.isfile(self.state_file))

        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state["yoloStatus"], "RUNNING")
        self.assertEqual(state["cameraStatus"], "CONNECTED")
        self.assertEqual(state["latestDetection"]["class"], "taiche")
        self.assertIsNotNone(state["sensors"])
        self.assertEqual(state["sensors"]["hc1"]["fillPercent"], 10)
        self.assertEqual(state["sensors"]["hc2"]["fillPercent"], 25)
        self.assertIsNone(state["sensors"]["hc3"])

    def test_detection_only_schema_remains_backward_compatible(self):
        # Publish detection without sensors field
        smartbin_yolo_bridge.publish_yolo_state(
            detection={
                "class": "khongtaiche",
                "confidence": 0.88,
                "timestamp": "2026-11-05T00:00:00+00:00"
            }
        )
        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state["yoloStatus"], "RUNNING")
        self.assertEqual(state["latestDetection"]["class"], "khongtaiche")
        self.assertIsNone(state["sensors"])

    def test_invalid_sensor_entry_does_not_break_yolo_state(self):
        sensors_with_invalid = {
            "hc1": {"fillPercent": -1, "updatedAtEpoch": time.time()},  # Invalid fill
            "hc2": {"fillPercent": 75, "updatedAtEpoch": time.time()},  # Valid fill
            "hc3": "not-a-dict"  # Malformed
        }
        detection = {
            "class": "huuco",
            "confidence": 0.91,
            "timestamp": "2026-11-05T00:00:00+00:00"
        }
        self.assertTrue(smartbin_yolo_bridge.publish_yolo_state(
            detection=detection,
            sensors=sensors_with_invalid
        ))

        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state["yoloStatus"], "RUNNING")
        self.assertEqual(state["latestDetection"]["class"], "huuco")
        self.assertIsNone(state["sensors"]["hc1"])
        self.assertEqual(state["sensors"]["hc2"]["fillPercent"], 75)
        self.assertIsNone(state["sensors"]["hc3"])

    def test_stale_sensor_in_file_becomes_unavailable(self):
        now = time.time()
        sensors_input = {
            "hc1": {"fillPercent": 50, "updatedAtEpoch": now - 16.0},  # Stale (>15s)
            "hc2": {"fillPercent": 25, "updatedAtEpoch": now - 3.0},   # Fresh
            "hc3": None
        }
        self.assertTrue(smartbin_yolo_bridge.publish_yolo_state(
            detection=None,
            sensors=sensors_input
        ))
        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state["yoloStatus"], "RUNNING")
        self.assertIsNone(state["sensors"]["hc1"])
        self.assertEqual(state["sensors"]["hc2"]["fillPercent"], 25)

    def test_stopped_state_has_none_sensors(self):
        self.assertTrue(smartbin_yolo_bridge.publish_yolo_state(
            detection=None,
            status="STOPPED",
            camera="DISCONNECTED",
            sensors=None
        ))
        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state["yoloStatus"], "STOPPED")
        self.assertIsNone(state["sensors"])


class TestPiAgentStage43Telemetry(unittest.TestCase):
    def test_agent_never_imports_pyserial(self):
        # Verify pi_agent module does not import serial or open serial ports
        self.assertNotIn("serial", pi_agent.__dict__)
        self.assertFalse(hasattr(pi_agent, "SERIAL_PORT"))

    def test_all_three_sensors_present_in_backend_telemetry_when_valid(self):
        now = time.time()
        mock_yolo_state = {
            "yoloStatus": "RUNNING",
            "cameraStatus": "CONNECTED",
            "latestDetection": {
                "class": "taiche",
                "confidence": 0.958,
                "timestamp": "2026-11-05T00:00:00+00:00"
            },
            "sensors": {
                "hc1": {"fillPercent": 10, "updatedAtEpoch": now - 1.0},
                "hc2": {"fillPercent": 25, "updatedAtEpoch": now - 2.0},
                "hc3": {"fillPercent": 40, "updatedAtEpoch": now - 3.0}
            }
        }
        with mock.patch.object(pi_agent, "read_yolo_state", return_value=mock_yolo_state), \
             mock.patch.object(pi_agent, "get_uptime_seconds", return_value=120), \
             mock.patch.object(pi_agent, "get_cpu_temp_c", return_value=48.5), \
             mock.patch.object(pi_agent, "get_local_ip", return_value="192.168.1.100"):
            payload = pi_agent.build_telemetry_payload()

        self.assertEqual(payload["deviceId"], "raspberry-pi-5")
        self.assertEqual(payload["status"], "ONLINE")
        self.assertIn("sensors", payload)
        sensors = payload["sensors"]

        # 1. Assert all 3 sensors are present
        self.assertIn("recyclable", sensors)
        self.assertIn("nonRecyclable", sensors)
        self.assertIn("organic", sensors)

        # 2. Assert exact fill percentages
        self.assertEqual(sensors["recyclable"]["fillLevel"], 10)
        self.assertEqual(sensors["nonRecyclable"]["fillLevel"], 25)
        self.assertEqual(sensors["organic"]["fillLevel"], 40)

        # 3. Assert status and distance contract
        for comp_name in ("recyclable", "nonRecyclable", "organic"):
            self.assertEqual(sensors[comp_name]["status"], "OK")
            self.assertIsNone(sensors[comp_name]["distanceCm"])
            self.assertIsNotNone(sensors[comp_name]["updatedAt"])

    def test_hc3_explicit_mapping_to_organic(self):
        now = time.time()
        mock_yolo_state = {
            "yoloStatus": "RUNNING",
            "cameraStatus": "CONNECTED",
            "latestDetection": None,
            "sensors": {
                "hc1": None,
                "hc2": None,
                "hc3": {"fillPercent": 77, "updatedAtEpoch": now - 1.0}
            }
        }
        with mock.patch.object(pi_agent, "read_yolo_state", return_value=mock_yolo_state):
            payload = pi_agent.build_telemetry_payload()

        self.assertIn("sensors", payload)
        sensors = payload["sensors"]
        self.assertNotIn("recyclable", sensors)
        self.assertNotIn("nonRecyclable", sensors)
        self.assertIn("organic", sensors)
        self.assertEqual(sensors["organic"]["fillLevel"], 77)

    def test_hc1_stale_does_not_affect_hc2_or_hc3(self):
        now = time.time()
        mock_yolo_state = {
            "yoloStatus": "RUNNING",
            "cameraStatus": "CONNECTED",
            "latestDetection": None,
            "sensors": {
                "hc1": None,  # HC1 stale or missing
                "hc2": {"fillPercent": 25, "updatedAtEpoch": now - 2.0},
                "hc3": {"fillPercent": 40, "updatedAtEpoch": now - 3.0}
            }
        }
        with mock.patch.object(pi_agent, "read_yolo_state", return_value=mock_yolo_state):
            payload = pi_agent.build_telemetry_payload()

        self.assertIn("sensors", payload)
        sensors = payload["sensors"]
        self.assertNotIn("recyclable", sensors, "Stale HC1 must be omitted")
        self.assertIn("nonRecyclable", sensors)
        self.assertEqual(sensors["nonRecyclable"]["fillLevel"], 25)
        self.assertIn("organic", sensors)
        self.assertEqual(sensors["organic"]["fillLevel"], 40)

    def test_hc2_missing_does_not_affect_hc1_or_hc3(self):
        now = time.time()
        mock_yolo_state = {
            "yoloStatus": "RUNNING",
            "cameraStatus": "CONNECTED",
            "latestDetection": None,
            "sensors": {
                "hc1": {"fillPercent": 10, "updatedAtEpoch": now - 1.0},
                "hc2": None,  # HC2 missing
                "hc3": {"fillPercent": 40, "updatedAtEpoch": now - 2.0}
            }
        }
        with mock.patch.object(pi_agent, "read_yolo_state", return_value=mock_yolo_state):
            payload = pi_agent.build_telemetry_payload()

        self.assertIn("sensors", payload)
        sensors = payload["sensors"]
        self.assertIn("recyclable", sensors)
        self.assertEqual(sensors["recyclable"]["fillLevel"], 10)
        self.assertNotIn("nonRecyclable", sensors, "Missing HC2 must be omitted")
        self.assertIn("organic", sensors)
        self.assertEqual(sensors["organic"]["fillLevel"], 40)

    def test_hc3_stale_does_not_affect_hc1_or_hc2(self):
        now = time.time()
        mock_yolo_state = {
            "yoloStatus": "RUNNING",
            "cameraStatus": "CONNECTED",
            "latestDetection": None,
            "sensors": {
                "hc1": {"fillPercent": 15, "updatedAtEpoch": now - 1.0},
                "hc2": {"fillPercent": 30, "updatedAtEpoch": now - 2.0},
                "hc3": None  # HC3 stale
            }
        }
        with mock.patch.object(pi_agent, "read_yolo_state", return_value=mock_yolo_state):
            payload = pi_agent.build_telemetry_payload()

        self.assertIn("sensors", payload)
        sensors = payload["sensors"]
        self.assertIn("recyclable", sensors)
        self.assertEqual(sensors["recyclable"]["fillLevel"], 15)
        self.assertIn("nonRecyclable", sensors)
        self.assertEqual(sensors["nonRecyclable"]["fillLevel"], 30)
        self.assertNotIn("organic", sensors, "Stale HC3 must be omitted")

    def test_missing_and_stale_sensors_never_become_zero(self):
        # Confirm neither None nor missing sensor values ever get coerced to 0
        mock_yolo_state = {
            "yoloStatus": "RUNNING",
            "cameraStatus": "CONNECTED",
            "latestDetection": None,
            "sensors": {
                "hc1": None,
                "hc2": None,
                "hc3": None
            }
        }
        with mock.patch.object(pi_agent, "read_yolo_state", return_value=mock_yolo_state):
            payload = pi_agent.build_telemetry_payload()

        self.assertNotIn("sensors", payload)
        if "sensors" in payload:
            for val in payload["sensors"].values():
                self.assertNotEqual(val.get("fillLevel"), 0, "Missing sensor must never become 0%")

    def test_telemetry_omits_sensors_when_all_sensors_none(self):
        mock_yolo_state = {
            "yoloStatus": "RUNNING",
            "cameraStatus": "CONNECTED",
            "latestDetection": None,
            "sensors": {
                "hc1": None,
                "hc2": None,
                "hc3": None
            }
        }
        with mock.patch.object(pi_agent, "read_yolo_state", return_value=mock_yolo_state):
            payload = pi_agent.build_telemetry_payload()

        self.assertNotIn("sensors", payload)

    def test_telemetry_omits_sensors_when_ipc_has_no_sensors_key(self):
        mock_yolo_state = {
            "yoloStatus": "RUNNING",
            "cameraStatus": "CONNECTED",
            "latestDetection": None,
            "sensors": None
        }
        with mock.patch.object(pi_agent, "read_yolo_state", return_value=mock_yolo_state):
            payload = pi_agent.build_telemetry_payload()

        self.assertNotIn("sensors", payload)


class TestFrontendStaleSensorContract(unittest.TestCase):
    """Verify that frontend source code strictly satisfies the unavailable-state contract."""

    def test_real_device_card_contract(self):
        card_path = DEVICE_DIR.parent / "web" / "src" / "real-device-card.tsx"
        content = card_path.read_text(encoding="utf-8")

        # 1. Verify placeholder '—' is displayed when !hasReading
        self.assertIn("{hasReading ? `${fillPct}%` : '—'}", content)

        # 2. Verify hasReading requires !isStale
        self.assertIn("!isStale", content)

        # 3. Verify progress bar has is-unavailable class when !hasReading
        self.assertIn("compartment-progress-bar ${!hasReading ? 'is-unavailable' : ''}", content)

        # 4. Verify progress fill uses is-unavailable class when not reading
        self.assertIn("compartment-progress-fill is-unavailable", content)

        # 5. Verify 3-compartment mapping order
        self.assertIn("renderCompartmentCard('RECYCLABLE', 'Rác tái chế (HC1)'", content)
        self.assertIn("renderCompartmentCard('NON_RECYCLABLE', 'Rác không tái chế (HC2)'", content)
        self.assertIn("renderCompartmentCard('ORGANIC', 'Rác hữu cơ (HC3)'", content)


if __name__ == "__main__":
    unittest.main(verbosity=2)

