#!/usr/bin/env python3
"""
Unit tests for safe telemetry normalization, station mapping, and ACK handling in Pi Agent.
Covers:
1. Integer fill percentage.
2. Float fill percentage.
3. Numeric string (with and without '%').
4. Boolean rejection (True/False).
5. NaN and Infinity rejection.
6. Out-of-range rejection (<0, >100).
7. Missing/invalid sensor data (None, empty, non-numeric).
8. Station A IPC mapping (hc1 -> recyclable, hc2 -> nonRecyclable, hc3 -> organic).
9. Station B serial mapping (fillPercent/fillLevel normalization).
10. Backend ACK success and failure logging.
"""

import math
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pi_agent
from smartbin_yolo_bridge import normalize_fill_level


class TestTelemetryNormalization(unittest.TestCase):
    def test_integer_fill_percentage(self):
        self.assertEqual(normalize_fill_level(0), 0)
        self.assertEqual(normalize_fill_level(50), 50)
        self.assertEqual(normalize_fill_level(100), 100)

    def test_float_fill_percentage(self):
        self.assertEqual(normalize_fill_level(45.0), 45)
        self.assertEqual(normalize_fill_level(45.4), 45)
        self.assertEqual(normalize_fill_level(45.6), 46)
        self.assertEqual(normalize_fill_level(0.0), 0)
        self.assertEqual(normalize_fill_level(100.0), 100)

    def test_numeric_string(self):
        self.assertEqual(normalize_fill_level("45"), 45)
        self.assertEqual(normalize_fill_level("45.2"), 45)
        self.assertEqual(normalize_fill_level(" 75 "), 75)
        self.assertEqual(normalize_fill_level("80%"), 80)
        self.assertEqual(normalize_fill_level("  85.6%  "), 86)

    def test_boolean_rejection(self):
        # In Python isinstance(True, int) is True, so explicit boolean check is required!
        self.assertIsNone(normalize_fill_level(True))
        self.assertIsNone(normalize_fill_level(False))

    def test_nan_and_infinity_rejection(self):
        self.assertIsNone(normalize_fill_level(float('nan')))
        self.assertIsNone(normalize_fill_level(float('inf')))
        self.assertIsNone(normalize_fill_level(float('-inf')))
        self.assertIsNone(normalize_fill_level("NaN"))
        self.assertIsNone(normalize_fill_level("Infinity"))

    def test_out_of_range_rejection(self):
        self.assertIsNone(normalize_fill_level(-1))
        self.assertIsNone(normalize_fill_level(-0.1))
        self.assertIsNone(normalize_fill_level(100.1))
        self.assertIsNone(normalize_fill_level(105))
        self.assertIsNone(normalize_fill_level("150%"))
        self.assertIsNone(normalize_fill_level("-5"))

    def test_missing_and_invalid_data(self):
        self.assertIsNone(normalize_fill_level(None))
        self.assertIsNone(normalize_fill_level(""))
        self.assertIsNone(normalize_fill_level("   "))
        self.assertIsNone(normalize_fill_level("abc"))
        self.assertIsNone(normalize_fill_level([]))
        self.assertIsNone(normalize_fill_level({}))

    def test_never_converts_invalid_to_zero(self):
        # 0 is valid 0%, but invalid values must return None, not 0
        self.assertEqual(normalize_fill_level(0), 0)
        self.assertIsNone(normalize_fill_level("invalid"))
        self.assertIsNone(normalize_fill_level(None))
        self.assertNotEqual(normalize_fill_level("invalid"), 0)


class TestStationMapping(unittest.TestCase):
    @mock.patch.object(pi_agent, 'read_yolo_state')
    def test_station_a_ipc_mapping(self, mock_yolo):
        now_epoch = time.time()
        mock_yolo.return_value = {
            'yoloStatus': 'RUNNING',
            'cameraStatus': 'CONNECTED',
            'latestDetection': None,
            'sensors': {
                'hc1': {'fillPercent': 25.4, 'updatedAtEpoch': now_epoch},
                'hc2': {'fillPercent': '65%', 'updatedAtEpoch': now_epoch},
                'hc3': {'fillPercent': 80, 'updatedAtEpoch': now_epoch}
            }
        }

        payload = pi_agent.build_telemetry_payload()
        self.assertEqual(payload['stationCode'], 'STATION_A')
        self.assertIn('sensors', payload)

        sensors = payload['sensors']
        # HC1 -> recyclable
        self.assertEqual(sensors['recyclable']['fillLevel'], 25)
        self.assertEqual(sensors['recyclable']['status'], 'OK')

        # HC2 -> nonRecyclable
        self.assertEqual(sensors['nonRecyclable']['fillLevel'], 65)
        self.assertEqual(sensors['nonRecyclable']['status'], 'OK')

        # HC3 -> organic
        self.assertEqual(sensors['organic']['fillLevel'], 80)
        self.assertEqual(sensors['organic']['status'], 'OK')

    def test_station_b_serial_mapping_normalization(self):
        mock_worker = mock.Mock()
        mock_worker.get_latest_data.return_value = {
            'stationCode': 'STATION_B',
            'deviceId': 'esp32c6-station-b',
            'bootCount': 1,
            'sampleSeq': 10,
            'bootId': 'boot-xyz',
            'sensors': {
                'recyclable': {'fillPercent': '72.8%', 'distanceCm': 14.5}
            }
        }

        with mock.patch.object(pi_agent, 'station_b_worker', mock_worker), \
             mock.patch.object(pi_agent, 'sio') as mock_sio:
            mock_sio.connected = True

            def capture_emit(event, payload, callback=None):
                if payload.get('stationCode') == 'STATION_B':
                    self.assertEqual(payload['sensors']['recyclable']['fillLevel'], 73)
                if callable(callback):
                    callback({'success': True, 'status': 'COMMITTED'})

            mock_sio.emit.side_effect = capture_emit
            self.assertTrue(pi_agent.send_telemetry())


class TestSocketIOAckHandling(unittest.TestCase):
    def test_station_a_ack_committed(self):
        with mock.patch.object(pi_agent, 'sio') as mock_sio, \
             mock.patch.object(pi_agent, 'build_telemetry_payload', return_value={
                 'stationCode': 'STATION_A',
                 'deviceId': 'raspberry-pi-5',
                 'uptimeSeconds': 100,
                 'cpuTempC': 45.0,
                 'subsystems': {'yolo': 'RUNNING', 'camera': 'CONNECTED'}
             }), \
             self.assertLogs(pi_agent.logger, level='INFO') as log:

            mock_sio.connected = True

            def emit_with_ack(event, payload, callback=None):
                if event == 'device:telemetry' and payload.get('stationCode') == 'STATION_A':
                    if callable(callback):
                        callback({'success': True, 'status': 'COMMITTED', 'timestamp': '2026-11-09T00:00:00Z'})

            mock_sio.emit.side_effect = emit_with_ack
            self.assertTrue(pi_agent.send_telemetry())
            self.assertTrue(any('Status: COMMITTED' in msg for msg in log.output))

    def test_station_a_ack_unknown_bin_logged(self):
        with mock.patch.object(pi_agent, 'sio') as mock_sio, \
             mock.patch.object(pi_agent, 'build_telemetry_payload', return_value={
                 'stationCode': 'STATION_A',
                 'deviceId': 'raspberry-pi-5',
                 'uptimeSeconds': 100,
                 'cpuTempC': 45.0,
                 'subsystems': {'yolo': 'RUNNING', 'camera': 'CONNECTED'}
             }), \
             self.assertLogs(pi_agent.logger, level='INFO') as log:

            mock_sio.connected = True

            def emit_with_ack(event, payload, callback=None):
                if event == 'device:telemetry' and payload.get('stationCode') == 'STATION_A':
                    if callable(callback):
                        callback({'success': False, 'status': 'UNKNOWN_BIN'})

            mock_sio.emit.side_effect = emit_with_ack
            self.assertTrue(pi_agent.send_telemetry())
            self.assertTrue(any('Status: UNKNOWN_BIN' in msg for msg in log.output))

    def test_station_a_ack_timeout(self):
        with mock.patch.object(pi_agent, 'sio') as mock_sio, \
             mock.patch.object(pi_agent, 'build_telemetry_payload', return_value={
                 'stationCode': 'STATION_A',
                 'deviceId': 'raspberry-pi-5',
                 'uptimeSeconds': 100,
                 'cpuTempC': 45.0,
                 'subsystems': {'yolo': 'RUNNING', 'camera': 'CONNECTED'}
             }), \
             mock.patch('threading.Event.wait', return_value=False), \
             self.assertLogs(pi_agent.logger, level='WARNING') as log:

            mock_sio.connected = True
            self.assertTrue(pi_agent.send_telemetry())
            self.assertTrue(any('ACK timed out' in msg for msg in log.output))


if __name__ == '__main__':
    unittest.main(verbosity=2)
