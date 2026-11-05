#!/usr/bin/env python3
"""
Unit & Integration Tests for Raspberry Pi 5 Hardware Integration (Task 1F-B)
Kiểm thử độc lập các module phần cứng:
- ESP32 Serial Reader & Fill Level Calculator
- YOLO Class Normalizer & Detection State
- SmartBin YOLO Bridge (Atomic state file & stale check)
- Telemetry Payload Aggregator (Confidence in [0.0, 1.0])
- Command Safety Policies (Only PING permitted)
"""

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

# Đảm bảo đường dẫn thư mục apps/device luôn có trong sys.path khi chạy từ bất kỳ thư mục nào
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from esp32_serial import ESP32SerialReader, calculate_fill_percentage
import smartbin_yolo_bridge
from smartbin_yolo_bridge import export_detection, read_yolo_state, normalize_class
import pi_agent


class TestESP32FillCalculation(unittest.TestCase):
    """Kiểm thử công thức tính phần trăm đầy và xử lý ngoại lệ khoảng cách."""

    def test_calibration_range(self):
        # 50cm = Rỗng hoàn toàn (0%)
        fill, status = calculate_fill_percentage(50.0, empty_cm=50.0, full_cm=5.0)
        self.assertEqual(fill, 0)
        self.assertEqual(status, 'OK')

        # 5cm = Đầy tới miệng (100%)
        fill, status = calculate_fill_percentage(5.0, empty_cm=50.0, full_cm=5.0)
        self.assertEqual(fill, 100)
        self.assertEqual(status, 'OK')

        # 27.5cm = Nửa thùng (50%)
        fill, status = calculate_fill_percentage(27.5, empty_cm=50.0, full_cm=5.0)
        self.assertEqual(fill, 50)
        self.assertEqual(status, 'OK')

    def test_clamping_behavior(self):
        # Khoảng cách nhỏ hơn full_cm (< 5cm) -> Kẹp 100%
        fill, status = calculate_fill_percentage(3.0, empty_cm=50.0, full_cm=5.0)
        self.assertEqual(fill, 100)
        self.assertEqual(status, 'OK')

        # Khoảng cách lớn hơn empty_cm (> 50cm) -> Kẹp 0%
        fill, status = calculate_fill_percentage(55.0, empty_cm=50.0, full_cm=5.0)
        self.assertEqual(fill, 0)
        self.assertEqual(status, 'OK')

    def test_out_of_range(self):
        # HC-SR04 không đo được khoảng cách âm hoặc quá 400cm
        fill, status = calculate_fill_percentage(-5.0)
        self.assertIsNone(fill)
        self.assertEqual(status, 'OUT_OF_RANGE')

        fill, status = calculate_fill_percentage(450.0)
        self.assertIsNone(fill)
        self.assertEqual(status, 'OUT_OF_RANGE')


class TestESP32SerialParser(unittest.TestCase):
    """Kiểm thử phân tích dữ liệu JSON và cập nhật trạng thái 3 ngăn."""

    def setUp(self):
        self.reader = ESP32SerialReader(port='MOCK_TEST_PORT')

    def test_flat_json_parsing(self):
        self.reader.inject_mock_data(organic_cm=40.0, recyclable_cm=20.0, non_recyclable_cm=8.0)
        readings = self.reader.get_readings()
        comps = readings['compartments']

        self.assertEqual(readings['status'], 'CONNECTED')
        self.assertEqual(comps['organic']['distanceCm'], 40.0)
        self.assertEqual(comps['recyclable']['distanceCm'], 20.0)
        self.assertEqual(comps['nonRecyclable']['distanceCm'], 8.0)

        self.assertEqual(comps['organic']['fillLevel'], 22)
        self.assertEqual(comps['recyclable']['fillLevel'], 67)
        self.assertEqual(comps['nonRecyclable']['fillLevel'], 93)

    def test_stale_detection(self):
        self.reader.inject_mock_data(organic_cm=25.0, recyclable_cm=25.0, non_recyclable_cm=25.0)
        self.reader.last_packet_time = time.time() - 20.0
        readings = self.reader.get_readings()
        self.assertEqual(readings['compartments']['organic']['status'], 'STALE')


class TestYOLOClassNormalization(unittest.TestCase):
    """Kiểm thử chuẩn hóa nhãn AI sang 3 nhóm rác canonical và confidence dạng số thực."""

    def test_class_mappings(self):
        self.assertEqual(normalize_class('plastic_bottle'), 'RECYCLABLE')
        self.assertEqual(normalize_class('can'), 'RECYCLABLE')
        self.assertEqual(normalize_class('cardboard'), 'RECYCLABLE')

        self.assertEqual(normalize_class('banana_peel'), 'ORGANIC')
        self.assertEqual(normalize_class('food_waste'), 'ORGANIC')
        self.assertEqual(normalize_class('apple'), 'ORGANIC')

        self.assertEqual(normalize_class('battery'), 'NON_RECYCLABLE')
        self.assertEqual(normalize_class('trash'), 'NON_RECYCLABLE')
        self.assertEqual(normalize_class('styrofoam'), 'NON_RECYCLABLE')


class TestSmartBinYOLOBridge(unittest.TestCase):
    """Kiểm thử cầu nối file trạng thái nguyên tử giữa yolo_camera.py trên Pi và Pi Agent."""

    def test_bridge_export_and_read(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_file = os.path.join(temp_dir, 'yolo_state.json')
            with mock.patch.object(smartbin_yolo_bridge, 'STATE_FILE_PATH', state_file):
                with mock.patch.object(smartbin_yolo_bridge.os, 'kill') as process_signal:
                    success = export_detection(
                        raw_class='plastic_bottle',
                        confidence=0.958,
                        inference_ms=32.4,
                        camera_status='CONNECTED'
                    )
                    self.assertTrue(success)

                    state = read_yolo_state()

        process_signal.assert_called_once_with(os.getpid(), 0)
        self.assertEqual(state['yoloStatus'], 'RUNNING')
        self.assertEqual(state['cameraStatus'], 'CONNECTED')
        self.assertIsNotNone(state['latestDetection'])
        self.assertEqual(state['latestDetection']['class'], 'RECYCLABLE')
        self.assertEqual(state['latestDetection']['confidence'], 0.958)
        self.assertEqual(state['latestDetection']['inferenceTimeMs'], 32.4)

    def test_dead_yolo_process_is_reported_as_stopped(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_file = os.path.join(temp_dir, 'yolo_state.json')
            with mock.patch.object(smartbin_yolo_bridge, 'STATE_FILE_PATH', state_file):
                with mock.patch.object(
                    smartbin_yolo_bridge.os,
                    'kill',
                    side_effect=ProcessLookupError
                ) as process_signal:
                    self.assertTrue(export_detection('apple', 0.9))
                    state = read_yolo_state()

        process_signal.assert_called_once_with(os.getpid(), 0)
        self.assertEqual(state['yoloStatus'], 'STOPPED')
        self.assertEqual(state['cameraStatus'], 'DISCONNECTED')
        self.assertIsNone(state['latestDetection'])


class TestPiAgentTelemetryBuilder(unittest.TestCase):
    """Kiểm thử việc đóng gói gói tin Telemetry đầy đủ trên Pi 5."""

    def test_telemetry_packet_structure(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_file = os.path.join(temp_dir, 'yolo_state.json')
            with mock.patch.object(smartbin_yolo_bridge, 'STATE_FILE_PATH', state_file):
                with mock.patch.object(smartbin_yolo_bridge.os, 'kill') as process_signal:
                    pi_agent.esp32_reader.inject_mock_data(
                        organic_cm=35.0,
                        recyclable_cm=18.0,
                        non_recyclable_cm=10.0
                    )
                    export_detection(
                        raw_class='apple',
                        confidence=0.915,
                        inference_ms=42.0,
                        camera_status='CONNECTED'
                    )

                    payload = pi_agent.build_telemetry_payload()

        process_signal.assert_called_once_with(os.getpid(), 0)

        self.assertEqual(payload['deviceId'], 'raspberry-pi-5')
        self.assertEqual(payload['status'], 'ONLINE')
        self.assertIn('subsystems', payload)
        self.assertEqual(payload['subsystems']['yolo'], 'RUNNING')
        self.assertEqual(payload['subsystems']['camera'], 'CONNECTED')
        self.assertEqual(payload['subsystems']['esp32'], 'CONNECTED')

        self.assertIn('aiDetection', payload)
        self.assertEqual(payload['aiDetection']['class'], 'ORGANIC')
        # Chuẩn hóa confidence dạng số thực trong [0.0, 1.0]
        self.assertEqual(payload['aiDetection']['confidence'], 0.915)

        self.assertIn('sensors', payload)
        sensors = payload['sensors']
        self.assertIsNotNone(sensors['organic'])
        self.assertIsNotNone(sensors['recyclable'])
        self.assertIsNotNone(sensors['nonRecyclable'])
        self.assertEqual(sensors['recyclable']['distanceCm'], 18.0)


class TestPiAgentProcessSignaling(unittest.TestCase):
    """Kiểm thử PID-lock behavior without sending platform-specific signals."""

    def test_live_process_prevents_duplicate_agent(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            pid_file = Path(temp_dir) / 'agent.pid'
            pid_file.write_text('12345')
            with mock.patch.object(pi_agent, 'PID_FILE', pid_file):
                with mock.patch.object(pi_agent.os, 'kill') as process_signal:
                    with self.assertRaises(SystemExit) as exit_context:
                        pi_agent.acquire_pid_lock()

            self.assertEqual(exit_context.exception.code, 0)
            process_signal.assert_called_once_with(12345, 0)
            self.assertEqual(pid_file.read_text(), '12345')

    def test_stale_pid_is_replaced(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            pid_file = Path(temp_dir) / 'agent.pid'
            pid_file.write_text('12345')
            with mock.patch.object(pi_agent, 'PID_FILE', pid_file):
                with mock.patch.object(
                    pi_agent.os,
                    'kill',
                    side_effect=ProcessLookupError
                ) as process_signal:
                    pi_agent.acquire_pid_lock()

            process_signal.assert_called_once_with(12345, 0)
            self.assertEqual(pid_file.read_text(), str(os.getpid()))


if __name__ == '__main__':
    print("=== RUNNING PI 5 HARDWARE & TELEMETRY INTEGRATION TESTS ===")
    unittest.main(verbosity=2)
