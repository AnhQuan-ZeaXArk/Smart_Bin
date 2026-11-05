import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

import pi_agent
import smartbin_yolo_bridge


class TestSocketConnectionHandling(unittest.TestCase):
    def setUp(self):
        self.client = mock.Mock()
        self.client.connected = False
        self.sio_patch = mock.patch.object(pi_agent, 'sio', self.client)
        self.token_patch = mock.patch.object(pi_agent, 'DEVICE_INGEST_TOKEN', 'test-token')
        self.delay_patch = mock.patch.object(pi_agent, '_socket_retry_delay', 2.0)
        self.next_retry_patch = mock.patch.object(pi_agent, '_next_socket_retry_at', 0.0)
        self.sio_patch.start()
        self.token_patch.start()
        self.delay_patch.start()
        self.next_retry_patch.start()

    def tearDown(self):
        self.next_retry_patch.stop()
        self.delay_patch.stop()
        self.token_patch.stop()
        self.sio_patch.stop()

    def test_connection_uses_backend_device_auth_and_is_not_duplicated(self):
        def connect(*args, **kwargs):
            self.client.connected = True

        self.client.connect.side_effect = connect
        self.assertTrue(pi_agent.ensure_socket_connection(now=100))
        self.client.connect.assert_called_once_with(
            pi_agent.SERVER_URL,
            auth={
                'type': 'device',
                'token': 'test-token',
                'deviceId': 'raspberry-pi-5'
            },
            transports=['websocket', 'polling'],
            wait_timeout=5
        )

        self.assertTrue(pi_agent.ensure_socket_connection(now=101))
        self.client.connect.assert_called_once()

    def test_failed_connection_retries_with_bounded_backoff_without_logging_token(self):
        def connect(*args, **kwargs):
            if self.client.connect.call_count == 1:
                raise ConnectionError('test-token must not be logged')
            self.client.connected = True

        self.client.connect.side_effect = connect
        with self.assertLogs(pi_agent.logger, level='WARNING') as logs:
            self.assertFalse(pi_agent.ensure_socket_connection(now=100))
        self.assertNotIn('test-token', '\n'.join(logs.output))
        self.assertEqual(pi_agent._next_socket_retry_at, 102)
        self.assertEqual(pi_agent._socket_retry_delay, 4)

        self.assertFalse(pi_agent.ensure_socket_connection(now=101))
        self.assertEqual(self.client.connect.call_count, 1)
        self.assertTrue(pi_agent.ensure_socket_connection(now=102))
        self.assertEqual(self.client.connect.call_count, 2)

    def test_concurrent_attempt_guard_prevents_duplicate_connection(self):
        with pi_agent._socket_connect_lock:
            self.assertFalse(pi_agent.ensure_socket_connection(now=100))
        self.client.connect.assert_not_called()

    def test_retry_backoff_is_capped(self):
        self.client.connect.side_effect = ConnectionError('offline')
        now = 100.0
        with self.assertLogs(pi_agent.logger, level='WARNING'):
            for _ in range(10):
                self.assertFalse(pi_agent.ensure_socket_connection(now=now))
                now = pi_agent._next_socket_retry_at
        self.assertEqual(pi_agent._socket_retry_delay, pi_agent.SOCKET_RETRY_MAX_SEC)


class TestTelemetryFallback(unittest.TestCase):
    def setUp(self):
        self.client = mock.Mock()
        self.client.connected = False
        self.requests = mock.Mock()
        self.response = mock.Mock(status_code=200)
        self.requests.post.return_value = self.response
        self.patches = [
            mock.patch.object(pi_agent, 'sio', self.client),
            mock.patch.object(pi_agent, 'requests', self.requests),
            mock.patch.object(pi_agent, 'DEVICE_INGEST_TOKEN', 'test-token'),
            mock.patch.object(pi_agent, 'build_telemetry_payload', return_value={
                'deviceId': 'raspberry-pi-5',
                'uptimeSeconds': 12,
                'cpuTempC': 47.5,
                'subsystems': {
                    'yolo': 'RUNNING',
                    'camera': 'CONNECTED'
                },
                'sentAt': '2026-11-05T00:00:00+00:00'
            })
        ]
        for patcher in self.patches:
            patcher.start()

    def tearDown(self):
        for patcher in reversed(self.patches):
            patcher.stop()

    def test_http_fallback_uses_bearer_auth_when_socket_is_disconnected(self):
        self.assertTrue(pi_agent.send_telemetry())
        kwargs = self.requests.post.call_args.kwargs
        self.assertEqual(
            self.requests.post.call_args.args[0],
            f'{pi_agent.SERVER_URL}/api/demo/device-heartbeat'
        )
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer test-token')
        self.assertEqual(kwargs['json']['deviceId'], 'raspberry-pi-5')
        self.assertEqual(kwargs['timeout'], 5)
        self.client.emit.assert_not_called()

    def test_connected_socket_avoids_http_fallback(self):
        self.client.connected = True
        self.assertTrue(pi_agent.send_telemetry())
        self.client.emit.assert_called_once_with(
            'device:telemetry',
            mock.ANY
        )
        self.requests.post.assert_not_called()

    def test_http_fallback_is_used_if_socket_emit_fails(self):
        self.client.connected = True
        self.client.emit.side_effect = OSError('temporary network failure')
        self.assertTrue(pi_agent.send_telemetry())
        self.requests.post.assert_called_once()


class TestSafeDeviceCommands(unittest.TestCase):
    def setUp(self):
        self.client = mock.Mock()
        self.patches = [
            mock.patch.object(pi_agent, 'sio', self.client),
            mock.patch.object(pi_agent, 'get_cpu_temp_c', return_value=47.5),
            mock.patch.object(pi_agent, 'get_uptime_seconds', return_value=120),
            mock.patch.object(pi_agent, 'read_yolo_state', return_value={
                'yoloStatus': 'RUNNING',
                'cameraStatus': 'CONNECTED'
            })
        ]
        self.mocks = [patcher.start() for patcher in self.patches]
        self.cpu_temp = self.mocks[1]
        self.uptime = self.mocks[2]
        self.yolo_reader = self.mocks[3]

    def tearDown(self):
        for patcher in reversed(self.patches):
            patcher.stop()

    def test_ping_returns_one_terminal_ack_without_hardware_control(self):
        pi_agent.on_device_command({
            'commandId': 'ping-1',
            'deviceId': 'raspberry-pi-5',
            'action': 'PING'
        })

        self.client.emit.assert_called_once()
        event, ack = self.client.emit.call_args.args
        self.assertEqual(event, 'device:command:ack')
        self.assertEqual(ack['status'], 'COMPLETED')
        self.assertEqual(ack['commandId'], 'ping-1')
        self.assertEqual(ack['deviceId'], 'raspberry-pi-5')
        self.assertEqual(ack['result']['subsystems']['yolo'], 'RUNNING')
        self.assertNotIn('esp32', ack['result']['subsystems'])

    def test_non_ping_commands_are_rejected_without_hardware_access(self):
        for action in ('TRIGGER_ULTRASONIC', 'OPEN_LID', 'SYSTEM_REBOOT', 'SERVO_OPEN'):
            with self.subTest(action=action):
                self.client.reset_mock()
                pi_agent.on_device_command({
                    'commandId': f'{action.lower()}-1',
                    'deviceId': 'raspberry-pi-5',
                    'action': action
                })
                self.client.emit.assert_called_once()
                ack = self.client.emit.call_args.args[1]
                self.assertEqual(ack['status'], 'FAILED')
                self.assertEqual(ack['error'], 'ACTION_NOT_PERMITTED')
                self.assertEqual(ack['action'], action)
        self.cpu_temp.assert_not_called()
        self.uptime.assert_not_called()
        self.yolo_reader.assert_not_called()

    def test_malformed_command_is_not_acknowledged(self):
        pi_agent.on_device_command({'commandId': '', 'action': 'PING'})
        self.client.emit.assert_not_called()


class TestYOLOIPCReader(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state_file = os.path.join(self.temp_dir.name, 'state.json')
        self.path_patch = mock.patch.object(
            smartbin_yolo_bridge,
            'STATE_FILE_PATH',
            self.state_file
        )
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.temp_dir.cleanup()

    def write_state(self, **overrides):
        data = {
            'status': 'RUNNING',
            'camera': 'CONNECTED',
            'updatedAtEpoch': time.time(),
            'detection': {
                'class': 'taiche',
                'confidence': 0.958,
                'timestamp': '2026-11-05T00:00:00+00:00'
            }
        }
        data.update(overrides)
        with open(self.state_file, 'w', encoding='utf-8') as state_file:
            json.dump(data, state_file)

    def test_missing_file_is_stopped(self):
        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state['yoloStatus'], 'STOPPED')
        self.assertIsNone(state['latestDetection'])

    def test_malformed_json_is_unavailable_without_exception(self):
        with open(self.state_file, 'w', encoding='utf-8') as state_file:
            state_file.write('{invalid')
        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state['yoloStatus'], 'STOPPED')
        self.assertIsNone(state['latestDetection'])

    def test_valid_state_preserves_detection_and_float_confidence(self):
        self.write_state()
        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state['yoloStatus'], 'RUNNING')
        self.assertEqual(state['cameraStatus'], 'CONNECTED')
        self.assertEqual(state['latestDetection']['class'], 'taiche')
        self.assertEqual(state['latestDetection']['confidence'], 0.958)
        self.assertIs(type(state['latestDetection']['confidence']), float)
        self.assertEqual(state['latestDetection']['timestamp'], '2026-11-05T00:00:00+00:00')

    def test_no_detection_is_running_without_fabricated_data(self):
        self.write_state(detection=None)
        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state['yoloStatus'], 'RUNNING')
        self.assertEqual(state['cameraStatus'], 'CONNECTED')
        self.assertIsNone(state['latestDetection'])

    def test_stale_and_future_state_are_not_reported_as_live(self):
        self.write_state(updatedAtEpoch=time.time() - 10)
        stale = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(stale['yoloStatus'], 'STOPPED')
        self.assertIsNone(stale['latestDetection'])

        self.write_state(updatedAtEpoch=time.time() + 60)
        future = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(future['yoloStatus'], 'STOPPED')
        self.assertIsNone(future['latestDetection'])

    def test_invalid_confidence_is_rejected_not_coerced_or_clamped(self):
        for confidence in (-0.1, 1.01, '0.9', None, True, float('nan')):
            with self.subTest(confidence=confidence):
                self.write_state(detection={
                    'class': 'taiche',
                    'confidence': confidence,
                    'timestamp': '2026-11-05T00:00:00+00:00'
                })
                state = smartbin_yolo_bridge.read_yolo_state()
                self.assertEqual(state['yoloStatus'], 'STOPPED')
                self.assertIsNone(state['latestDetection'])

    def test_invalid_class_is_rejected(self):
        self.write_state(detection={
            'class': 'plastic_bottle',
            'confidence': 0.9,
            'timestamp': '2026-11-05T00:00:00+00:00'
        })
        state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(state['yoloStatus'], 'STOPPED')
        self.assertIsNone(state['latestDetection'])

    def test_missing_required_fields_are_rejected(self):
        for state_fields in (
            {'status': 'RUNNING', 'camera': 'CONNECTED', 'updatedAtEpoch': time.time()},
            {
                'status': 'RUNNING',
                'camera': 'CONNECTED',
                'updatedAtEpoch': time.time(),
                'detection': {'class': 'taiche', 'confidence': 0.9}
            }
        ):
            with self.subTest(state_fields=state_fields):
                with open(self.state_file, 'w', encoding='utf-8') as state_file:
                    json.dump(state_fields, state_file)
                state = smartbin_yolo_bridge.read_yolo_state()
                self.assertEqual(state['yoloStatus'], 'STOPPED')
                self.assertIsNone(state['latestDetection'])

    def test_invalid_iso_timestamp_is_rejected(self):
        for timestamp in ('not-a-timestamp', '2026-11-05T00:00:00', '2026-11-05T00:00:00+01:00'):
            with self.subTest(timestamp=timestamp):
                self.write_state(detection={
                    'class': 'taiche',
                    'confidence': 0.9,
                    'timestamp': timestamp
                })
                state = smartbin_yolo_bridge.read_yolo_state()
                self.assertEqual(state['yoloStatus'], 'STOPPED')
                self.assertIsNone(state['latestDetection'])

    def test_atomic_writer_publishes_exact_schema_using_same_directory_replace(self):
        detection = {
            'class': 'khongtaiche',
            'confidence': 0.92,
            'timestamp': '2026-11-05T00:00:00+00:00'
        }
        real_replace = os.replace
        replacements = []

        def capture_replace(source, destination):
            replacements.append((source, destination))
            self.assertEqual(os.path.dirname(source), os.path.dirname(destination))
            with open(source, 'r', encoding='utf-8') as state_file:
                written = json.load(state_file)
            self.assertEqual(set(written), {
                'status', 'camera', 'updatedAtEpoch', 'detection'
            })
            self.assertEqual(written['detection'], detection)
            return real_replace(source, destination)

        with mock.patch.object(smartbin_yolo_bridge.os, 'replace', side_effect=capture_replace):
            self.assertTrue(smartbin_yolo_bridge.publish_yolo_state(detection))
        self.assertEqual(len(replacements), 1)
        self.assertTrue(os.path.isfile(self.state_file))

    def test_writer_publishes_no_detection_and_stopped_state(self):
        self.assertTrue(smartbin_yolo_bridge.publish_yolo_state())
        live_state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(live_state['yoloStatus'], 'RUNNING')
        self.assertIsNone(live_state['latestDetection'])

        self.assertTrue(smartbin_yolo_bridge.publish_yolo_state(
            status='STOPPED',
            camera='DISCONNECTED'
        ))
        stopped_state = smartbin_yolo_bridge.read_yolo_state()
        self.assertEqual(stopped_state['yoloStatus'], 'STOPPED')
        self.assertEqual(stopped_state['cameraStatus'], 'DISCONNECTED')
        self.assertIsNone(stopped_state['latestDetection'])

    def test_atomic_writer_failure_is_reported_without_raising(self):
        with mock.patch.object(
            smartbin_yolo_bridge.os,
            'replace',
            side_effect=OSError('simulated file-system failure')
        ):
            with self.assertLogs(smartbin_yolo_bridge.logger, level='ERROR'):
                self.assertFalse(smartbin_yolo_bridge.publish_yolo_state())

    def test_agent_telemetry_omits_detection_when_ipc_is_unavailable(self):
        state = smartbin_yolo_bridge.read_yolo_state()
        with mock.patch.object(pi_agent, 'read_yolo_state', return_value=state), \
                mock.patch.object(pi_agent, 'get_uptime_seconds', return_value=10), \
                mock.patch.object(pi_agent, 'get_cpu_temp_c', return_value=None), \
                mock.patch.object(pi_agent, 'get_local_ip', return_value=None):
            payload = pi_agent.build_telemetry_payload()
        self.assertEqual(payload['subsystems']['yolo'], 'STOPPED')
        self.assertEqual(payload['subsystems']['camera'], 'DISCONNECTED')
        self.assertNotIn('aiDetection', payload)
        self.assertNotIn('sensors', payload)
        self.assertNotIn('esp32', payload['subsystems'])
        self.assertNotIn('lastInferenceMs', payload['metadata'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
