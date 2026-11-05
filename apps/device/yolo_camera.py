import logging
import cv2
import torch
import serial
import time
import math
import re
from datetime import datetime, timezone
from ultralytics import YOLO
from smartbin_yolo_bridge import publish_yolo_state

# =====================================================
# 1. CAU HINH YOLO
# =====================================================

MODEL_PATH = "/home/pi/best.pt"

CAMERA_INDEX = 0
CONFIDENCE = 0.35
IMAGE_SIZE = 416

# =====================================================
# 2. CAU HINH USB SERIAL ESP32-C6
# =====================================================

SERIAL_PORT = "/dev/ttyUSB0"
BAUD_RATE = 115200

logger = logging.getLogger("SmartBin-YOLO-IPC")
esp32 = None


# =====================================================
# 3. ANH XA TEN CLASS SANG LENH ESP32
# =====================================================

CLASS_TO_COMMAND = {
    "taiche": "taiche",
    "khongtaiche": "khongtaiche",
    "huuco": "huuco"
}

# Thoi gian vat the roi khoi camera
REARM_TIME = 1.5

servo_armed = True
last_detection_time = 0


# =====================================================
# 4. GUI LENH DIEU KHIEN SERVO
# =====================================================

def send_command(command):

    try:

        message = command + "\n"

        esp32.write(message.encode("utf-8"))
        esp32.flush()

        print("[PI -> ESP32]", command)

    except serial.SerialException as e:

        print("[USB SERIAL] Loi gui lenh:", e)


# =====================================================
# 5. DOC PHAN HOI TU ESP32 VA PARSE TELEMETRY CAM BIEN
# =====================================================

HC_VALID_TIMEOUT_SEC = 15.0

# Luu tru trang thai doc cam bien doc lap cho tung HC:
# {"fillPercent": int, "updatedAtEpoch": float}
sensor_state = {
    "hc1": None,
    "hc2": None,
    "hc3": None
}
_serial_buffer = ""


def read_esp32():
    global _serial_buffer

    try:
        if esp32 is None:
            return

        while esp32.in_waiting > 0:
            chunk = esp32.read(esp32.in_waiting).decode("utf-8", errors="ignore")
            _serial_buffer += chunk

        # Ngan buffer tran neu gap nhieu khong co newline
        if len(_serial_buffer) > 4096:
            _serial_buffer = _serial_buffer[-1024:]

        while "\n" in _serial_buffer:
            line, _serial_buffer = _serial_buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue

            print("[ESP32]", line)

            # Khop mau cam bien: HC1: <int>%, HC2: <int>%, HC3: <int>%
            match = re.match(r"^HC([123]):\s*(\d+)%$", line)
            if match:
                hc_num = match.group(1)
                percent_str = match.group(2)
                try:
                    percent_val = int(percent_str)
                    if 0 <= percent_val <= 100:
                        sensor_key = f"hc{hc_num}"
                        sensor_state[sensor_key] = {
                            "fillPercent": percent_val,
                            "updatedAtEpoch": time.time()
                        }
                except ValueError:
                    pass

    except serial.SerialException as e:
        print("[USB SERIAL] Loi doc:", e)


def get_live_sensors():
    now = time.time()
    has_any = False
    result = {}
    for key in ("hc1", "hc2", "hc3"):
        reading = sensor_state.get(key)
        if reading is not None:
            age = now - reading["updatedAtEpoch"]
            if 0 <= age <= HC_VALID_TIMEOUT_SEC and reading["updatedAtEpoch"] <= now:
                result[key] = {
                    "fillPercent": reading["fillPercent"],
                    "updatedAtEpoch": reading["updatedAtEpoch"]
                }
                has_any = True
            else:
                result[key] = None
        else:
            result[key] = None
    return result if has_any else None


# =====================================================
# 6. XU LY NHAN DIEN YOLO
# =====================================================

def process_detection(result):

    global servo_armed
    global last_detection_time

    now = time.monotonic()

    best_detection = None
    best_ipc_detection = None

    # Tim vat the co confidence cao nhat
    for box in result.boxes:

        confidence = float(box.conf[0])
        class_id = int(box.cls[0])

        if confidence < CONFIDENCE:
            continue

        class_name = str(
            result.names[class_id]
        ).strip().lower()

        command = CLASS_TO_COMMAND.get(class_name)

        if command is None:
            continue

        if math.isfinite(confidence) and 0 <= confidence <= 1 and (
            best_ipc_detection is None
            or confidence > best_ipc_detection[0]
        ):
            best_ipc_detection = (confidence, class_name)

        if (
            best_detection is None
            or confidence > best_detection[0]
        ):

            best_detection = (
                confidence,
                class_name,
                command
            )

    ipc_detection = None
    if best_ipc_detection is not None:
        ipc_confidence, ipc_class_name = best_ipc_detection
        ipc_detection = {
            "class": ipc_class_name,
            "confidence": ipc_confidence,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    # Neu phat hien vat the hop le
    if best_detection is not None:

        confidence, class_name, command = best_detection

        last_detection_time = now
        if servo_armed:

            print(
                f"[YOLO] Phat hien: {class_name} "
                f"| Confidence: {confidence:.2f}"
            )

            send_command(command)

            servo_armed = False

    # Neu khong phat hien vat the
    else:

        if not servo_armed:

            if now - last_detection_time >= REARM_TIME:

                servo_armed = True

                print(
                    "[SYSTEM] San sang nhan dien vat the moi"
                )

    return ipc_detection


def _publish_state_safely(detection=None, status="RUNNING", camera="CONNECTED", sensors=None):
    try:
        kwargs = {
            "detection": detection,
            "status": status,
            "camera": camera
        }
        if sensors is not None:
            kwargs["sensors"] = sensors
        if not publish_yolo_state(**kwargs):
            logger.warning("YOLO IPC state was not published.")
    except Exception:
        logger.exception("YOLO IPC publishing failed; inference will continue.")


def main():
    global esp32

    cap = None
    print("Dang ket noi ESP32-C6 qua USB Serial...")

    try:
        try:
            esp32 = serial.Serial(
                port=SERIAL_PORT,
                baudrate=BAUD_RATE,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=0.1,
                write_timeout=1
            )

            # Cho ESP32 khoi dong lai neu USB Serial reset board
            time.sleep(2)

            esp32.reset_input_buffer()
            esp32.reset_output_buffer()

            print("[USB SERIAL] Da ket noi ESP32-C6!")
            print("[USB SERIAL] Port:", SERIAL_PORT)

        except serial.SerialException as e:
            print("[ERROR] Khong ket noi duoc ESP32:", e)
            raise SystemExit(1)

        # =====================================================
        # 7. KHOI TAO MO HINH YOLO
        # =====================================================

        print("\nPyTorch:", torch.__version__)
        print("Device: CPU")

        print("Dang tai mo hinh YOLO...")

        model = YOLO(MODEL_PATH)

        print("Cac lop cua mo hinh:", model.names)

        print("\nDanh sach class:")

        for class_id, class_name in model.names.items():

            print(f"{class_id}: {class_name}")

        # =====================================================
        # 8. KHOI TAO CAMERA USB
        # =====================================================

        cap = cv2.VideoCapture(
            CAMERA_INDEX,
            cv2.CAP_V4L2
        )

        if not cap.isOpened():

            print("[ERROR] Khong mo duoc camera USB!")
            raise SystemExit(1)

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        print("\n[CAMERA] Da mo camera!")
        print("[ESP32] USB Serial:", SERIAL_PORT)
        print("[SYSTEM] Nhan Q de thoat.")

        # =====================================================
        # 9. VONG LAP CHINH
        # =====================================================

        while True:

            ret, frame = cap.read()

            if not ret:

                print("[CAMERA] Khong doc duoc hinh anh!")

                break

            # Chay YOLO tren CPU
            results = model.predict(
                source=frame,
                imgsz=IMAGE_SIZE,
                conf=CONFIDENCE,
                device="cpu",
                verbose=False
            )

            result = results[0]

            # Xu ly nhan dien va gui lenh USB Serial
            detection = process_detection(result)

            # Doc phan hoi ESP32 va cap nhat cam bien
            read_esp32()
            sensors = get_live_sensors()

            _publish_state_safely(
                detection=detection,
                status="RUNNING",
                camera="CONNECTED",
                sensors=sensors
            )

            # Ve bounding box
            annotated_frame = result.plot()

            cv2.imshow(
                "SmartBin - YOLO + ESP32 USB Serial",
                annotated_frame
            )

            # Nhan Q de thoat
            key = cv2.waitKey(1) & 0xFF

            if key == ord("q"):

                print("[SYSTEM] Dang dung chuong trinh...")

                break

    finally:

        if cap is not None:
            try:
                cap.release()
            except Exception:
                logger.exception("Could not release the YOLO camera.")
        try:
            cv2.destroyAllWindows()
        except Exception:
            logger.exception("Could not close the OpenCV windows.")
        try:
            if esp32 is not None and esp32.is_open:
                esp32.close()
        except Exception:
            logger.exception("Could not close the ESP32 serial connection.")

        _publish_state_safely(
            detection=None,
            status="STOPPED",
            camera="DISCONNECTED"
        )
        print("[SYSTEM] Da dong camera va USB Serial.")


if __name__ == "__main__":
    main()
