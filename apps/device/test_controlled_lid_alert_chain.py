#!/usr/bin/env python3
"""
Controlled End-to-End Test for Lid Error Alert Chain (Phase 1.1 / Phase 1.2):
Simulates raw Serial input from ESP32-C6 and verifies every layer:
1. Serial Parser (yolo_camera.py)
2. IPC File (/tmp/smartbin_yolo_state.json)
3. Pi Agent (pi_agent.py -> Socket.IO emit)
Tests both 'loi mo nap' and 'loi dong nap'.
"""

import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path
from unittest import mock

DEVICE_DIR = Path(__file__).resolve().parent
if str(DEVICE_DIR) not in sys.path:
    sys.path.insert(0, str(DEVICE_DIR))

import smartbin_yolo_bridge
import pi_agent


def load_mocked_yolo_camera():
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
            "yolo_camera_controlled",
            DEVICE_DIR / "yolo_camera.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod


yolo_camera = load_mocked_yolo_camera()


def run_controlled_chain_test(test_input_line: str, test_name: str) -> dict:
    print(f"\n=======================================================")
    print(f"RUNNING CONTROLLED CHAIN TEST: {test_name} ('{test_input_line}')")
    print(f"=======================================================\n")

    results = {}

    with tempfile.TemporaryDirectory() as tmp_dir:
        state_file = os.path.join(tmp_dir, "smartbin_yolo_state.json")
        ack_file = os.path.join(tmp_dir, "smartbin_backend_ack.json")

        smartbin_yolo_bridge.STATE_FILE_PATH = state_file
        smartbin_yolo_bridge.BACKEND_ACK_FILE_PATH = ack_file
        smartbin_yolo_bridge.reset_backend_ack_state()
        pi_agent.reset_online_collection_state()

        yolo_camera.reset_lid_alert_state()
        yolo_camera.reset_collection_session_state()
        yolo_camera.sensor_state = {"hc1": None, "hc2": None, "hc3": None}
        yolo_camera._serial_buffer = ""

        # --- BƯỚC 1: KIỂM TRA SERIAL PARSER ---
        print("--- [BƯỚC 1: SERIAL PARSER] ---")
        mock_serial = mock.Mock()
        mock_serial.in_waiting = 0
        yolo_camera.esp32 = mock_serial

        # Giả lập ESP32 gửi dòng test kèm \r\n
        yolo_camera._serial_buffer = f"{test_input_line}\r\n"
        yolo_camera.read_esp32()

        step1_pass = (
            yolo_camera.lid_alert is True
            and yolo_camera.last_lid_error in ("loi mo nap", "loi dong nap")
        )
        results["Serial Parser"] = "PASS" if step1_pass else "FAIL"
        print(f"-> Kết quả Bước 1 (Serial Parser): {results['Serial Parser']} (lid_alert={yolo_camera.lid_alert}, last_error='{yolo_camera.last_lid_error}')\n")

        # --- BƯỚC 2: KIỂM TRA IPC ---
        print("--- [BƯỚC 2: IPC FILE /tmp/smartbin_yolo_state.json] ---")
        yolo_camera._publish_state_safely(
            detection=None,
            status="RUNNING",
            camera="CONNECTED",
            sensors={"hc1": {"fillPercent": 50, "updatedAtEpoch": 1000.0}}
        )

        # Đọc trực tiếp từ file JSON trên đĩa
        if not os.path.exists(state_file):
            results["IPC"] = "FAIL (file does not exist)"
            step2_pass = False
        else:
            with open(state_file, "r", encoding="utf-8") as f:
                raw_json = json.load(f)

            has_field = "lidAlert" in raw_json
            val = raw_json.get("lidAlert")
            print(f"-> Kiểm tra file IPC JSON: field 'lidAlert' present={has_field}, value={val}")

            # Thử gửi thêm 5 frame cảm biến tiếp theo để xác nhận KHÔNG bị ghi đè
            for i in range(5):
                yolo_camera._publish_state_safely(
                    detection=None,
                    status="RUNNING",
                    camera="CONNECTED",
                    sensors={"hc1": {"fillPercent": 50 + i, "updatedAtEpoch": 1000.0 + i}}
                )
            with open(state_file, "r", encoding="utf-8") as f:
                after_frames_json = json.load(f)

            not_overwritten = after_frames_json.get("lidAlert") is True
            step2_pass = has_field and (val is True) and not_overwritten
            results["IPC"] = "PASS" if step2_pass else "FAIL"
            print(f"-> Kiểm tra chống ghi đè sau 5 frame: not_overwritten={not_overwritten}")
            print(f"-> Kết quả Bước 2 (IPC): {results['IPC']}\n")

        # --- BƯỚC 3: KIỂM TRA PI AGENT & SOCKET.IO ---
        print("--- [BƯỚC 3: PI AGENT & SOCKET.IO] ---")
        with mock.patch("pi_agent.read_yolo_state", smartbin_yolo_bridge.read_yolo_state):
            payload_a = pi_agent.build_telemetry_payload()
            telemetry_has_lid = payload_a.get("lidAlert") is True

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

                lid_alert_emits = [e for e in emitted_events if e[0] == "device:lid:alert"]
                has_emitted = len(lid_alert_emits) == 1
                if has_emitted:
                    ev_name, ev_data = lid_alert_emits[0]
                    msg_correct = ev_data.get("message") == "CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!"
                    no_bin_id = "binCode" not in ev_data and "binId" not in ev_data
                else:
                    msg_correct = False
                    no_bin_id = False

                step3_pass = telemetry_has_lid and has_emitted and msg_correct and no_bin_id
                results["Pi Agent"] = "PASS" if step3_pass else "FAIL"
                print(f"-> telemetry payload lidAlert={telemetry_has_lid}")
                print(f"-> emitted 'device:lid:alert' count={len(lid_alert_emits)}")
                print(f"-> message matches={msg_correct}, no bin identifiers={no_bin_id}")
                print(f"-> Kết quả Bước 3 (Pi Agent): {results['Pi Agent']}\n")

    return results


if __name__ == "__main__":
    print("================================================================")
    print("CHƯƠNG TRÌNH KIỂM THỬ CÓ KIỂM SOÁT TOÀN BỘ CHUỖI CẢNH BÁO LỖI NẮP")
    print("================================================================")

    res_open = run_controlled_chain_test("loi mo nap", "KỊCH BẢN 1: LỖI MỞ NẮP")
    res_close = run_controlled_chain_test("loi dong nap", "KỊCH BẢN 2: LỖI ĐÓNG NẮP")
    res_esp32_tag = run_controlled_chain_test("[ESP32] loi mo nap", "KỊCH BẢN 3: LỖI MỞ NẮP CÓ TIỀN TỐ [ESP32]")

    print("\n=======================================================")
    print("BẢNG TỔNG HỢP KIỂM THỬ THIẾT BỊ VÀ IPC (BƯỚC 1 -> BƯỚC 3):")
    print("=======================================================")
    print("| Tầng | Input | Kết quả |")
    print("|---|---|---|")
    print(f"| Serial Parser | loi mo nap | {res_open['Serial Parser']} |")
    print(f"| IPC | lidAlert: true | {res_open['IPC']} |")
    print(f"| Pi Agent | device:lid:alert | {res_open['Pi Agent']} |")
    print(f"| Serial Parser | loi dong nap | {res_close['Serial Parser']} |")
    print(f"| IPC | lidAlert: true | {res_close['IPC']} |")
    print(f"| Pi Agent | device:lid:alert | {res_close['Pi Agent']} |")
    print(f"| Serial Parser | [ESP32] loi mo nap | {res_esp32_tag['Serial Parser']} |")
    print(f"| IPC | lidAlert: true | {res_esp32_tag['IPC']} |")
    print(f"| Pi Agent | device:lid:alert | {res_esp32_tag['Pi Agent']} |")

    all_pass = all(
        v == "PASS" for r in (res_open, res_close, res_esp32_tag) for v in r.values()
    )
    if not all_pass:
        print("\n[ERROR] Một hoặc nhiều bước kiểm thử thất bại!")
        sys.exit(1)
    else:
        print("\n[SUCCESS] Tất cả các bước trên Thiết bị và IPC ĐÃ PASS 100%!")
        sys.exit(0)

