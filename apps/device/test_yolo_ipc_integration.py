import importlib.util
import logging
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

DEVICE_DIR = Path(__file__).resolve().parent
if str(DEVICE_DIR) not in sys.path:
    sys.path.insert(0, str(DEVICE_DIR))


def load_yolo_camera():
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

    serial = types.ModuleType("serial")
    serial.EIGHTBITS = 8
    serial.PARITY_NONE = "N"
    serial.STOPBITS_ONE = 1
    serial.SerialException = type("SerialException", (Exception,), {})
    serial.Serial = mock.Mock()

    ultralytics = types.ModuleType("ultralytics")
    ultralytics.YOLO = mock.Mock()

    fake_modules = {
        "cv2": cv2,
        "torch": torch,
        "serial": serial,
        "ultralytics": ultralytics
    }
    spec = importlib.util.spec_from_file_location(
        "smartbin_test_yolo_camera",
        DEVICE_DIR / "yolo_camera.py"
    )
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, fake_modules):
        spec.loader.exec_module(module)
    return module, cv2, serial, ultralytics


def make_box(confidence, class_id=0):
    return types.SimpleNamespace(conf=[confidence], cls=[class_id])


def make_result(boxes, names=None):
    return types.SimpleNamespace(
        boxes=boxes,
        names=names or {0: "taiche", 1: "khongtaiche", 2: "huuco"},
        plot=mock.Mock(return_value="annotated frame")
    )


class TestYoloDetectionForIPC(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.yolo, cls.cv2, cls.serial, cls.ultralytics = load_yolo_camera()

    def setUp(self):
        self.yolo.servo_armed = True
        self.yolo.last_detection_time = 0

    def test_valid_detection_returns_utc_timestamp(self):
        with mock.patch.object(self.yolo, "send_command") as send_command:
            detection = self.yolo.process_detection(make_result([make_box(0.92)]))

        self.assertEqual(detection["class"], "taiche")
        self.assertEqual(detection["confidence"], 0.92)
        self.assertTrue(detection["timestamp"].endswith("+00:00"))
        send_command.assert_called_once_with("taiche")

    def test_highest_confidence_valid_detection_is_selected(self):
        result = make_result([
            make_box(0.72, 0),
            make_box(0.96, 1),
            make_box(0.81, 2)
        ])
        with mock.patch.object(self.yolo, "send_command") as send_command:
            detection = self.yolo.process_detection(result)

        self.assertEqual(detection["class"], "khongtaiche")
        self.assertEqual(detection["confidence"], 0.96)
        send_command.assert_called_once_with("khongtaiche")

    def test_no_valid_class_or_invalid_confidence_produces_no_ipc_detection(self):
        with mock.patch.object(self.yolo, "send_command") as send_command:
            self.assertIsNone(self.yolo.process_detection(
                make_result([make_box(0.99)], names={0: "unknown"})
            ))
            self.assertIsNone(self.yolo.process_detection(
                make_result([make_box(1.2, 0)])
            ))

        send_command.assert_called_once_with("taiche")

    def test_ipc_chooses_highest_confidence_within_valid_range(self):
        result = make_result([
            make_box(0.94, 0),
            make_box(1.2, 1)
        ])
        with mock.patch.object(self.yolo, "send_command") as send_command:
            detection = self.yolo.process_detection(result)

        self.assertEqual(detection["class"], "taiche")
        self.assertEqual(detection["confidence"], 0.94)
        send_command.assert_called_once_with("khongtaiche")

    def test_no_detection_does_not_reuse_prior_detection(self):
        with mock.patch.object(self.yolo, "send_command"):
            first = self.yolo.process_detection(make_result([make_box(0.9)]))
            second = self.yolo.process_detection(make_result([]))

        self.assertIsNotNone(first)
        self.assertIsNone(second)


class TestYoloIPCProcessLifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.yolo, cls.cv2, cls.serial, cls.ultralytics = load_yolo_camera()

    def setUp(self):
        self.cv2.destroyAllWindows.reset_mock()
        self.cv2.VideoCapture.reset_mock()
        self.cv2.imshow.reset_mock()
        self.cv2.waitKey.reset_mock()
        self.cv2.waitKey.return_value = ord("q")
        self.serial.Serial.reset_mock()
        self.serial_connection = mock.Mock()
        self.serial_connection.is_open = True
        self.serial_connection.in_waiting = 0
        self.serial.Serial.return_value = self.serial_connection
        self.camera = mock.Mock()
        self.camera.isOpened.return_value = True
        self.camera.read.side_effect = [(True, "frame"), (False, None)]
        self.cv2.VideoCapture.return_value = self.camera
        self.model = mock.Mock()
        self.model.names = {0: "taiche"}
        self.model.predict.return_value = [make_result([make_box(0.9)])]
        self.ultralytics.YOLO.return_value = self.model
        self.yolo.servo_armed = True
        self.yolo.last_detection_time = 0
        self.publish = mock.patch.object(self.yolo, "publish_yolo_state")
        self.publish_state = self.publish.start()
        self.sleep = mock.patch.object(self.yolo.time, "sleep")
        self.sleep.start()

    def tearDown(self):
        self.sleep.stop()
        self.publish.stop()

    def test_camera_failure_publishes_stopped_and_releases_serial(self):
        self.camera.isOpened.return_value = False

        with mock.patch.object(self.yolo, "read_esp32") as read_esp32:
            with self.assertRaises(SystemExit) as exit_context:
                self.yolo.main()

        self.assertEqual(exit_context.exception.code, 1)
        self.publish_state.assert_called_once_with(
            detection=None,
            status="STOPPED",
            camera="DISCONNECTED"
        )
        self.camera.release.assert_called_once()
        self.serial_connection.close.assert_called_once()
        self.cv2.destroyAllWindows.assert_called_once()
        read_esp32.assert_not_called()

    def test_successful_inference_publishes_each_frame_then_stopped(self):
        self.camera.read.side_effect = [
            (True, "frame with detection"),
            (True, "frame without detection"),
            (False, None)
        ]
        self.model.predict.side_effect = [
            [make_result([make_box(0.9)])],
            [make_result([])]
        ]
        self.cv2.waitKey.side_effect = [0, ord("q")]

        with mock.patch.object(self.yolo, "send_command") as send_command:
            self.yolo.main()

        self.assertEqual(self.model.predict.call_count, 2)
        self.assertEqual(self.publish_state.call_count, 3)
        first_detection = self.publish_state.call_args_list[0].kwargs["detection"]
        self.assertEqual(first_detection["class"], "taiche")
        self.assertIsNone(self.publish_state.call_args_list[1].kwargs["detection"])
        self.assertEqual(self.publish_state.call_args_list[1].kwargs["status"], "RUNNING")
        self.assertEqual(self.publish_state.call_args_list[2].kwargs, {
            "detection": None,
            "status": "STOPPED",
            "camera": "DISCONNECTED"
        })
        send_command.assert_called_once_with("taiche")
        self.camera.release.assert_called_once()
        self.serial_connection.close.assert_called_once()

    def test_ipc_writer_failure_does_not_interrupt_inference_or_cleanup(self):
        self.publish_state.side_effect = OSError("IPC unavailable")

        with self.assertLogs("SmartBin-YOLO-IPC", level=logging.ERROR):
            self.yolo.main()

        self.model.predict.assert_called_once()
        self.camera.release.assert_called_once()
        self.serial_connection.close.assert_called_once()
        self.assertEqual(self.publish_state.call_count, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
