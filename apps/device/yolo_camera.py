import logging
import cv2
import torch
import serial
import time
import math
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from ultralytics import YOLO
from smartbin_yolo_bridge import get_acknowledged_backend_event_ids, publish_yolo_state

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

STATION_ID = "station_a"
COLLECTION_SOURCE = "PHYSICAL_BUTTON"
MANUAL_OPEN_MESSAGE = "THU CONG: MO CA 3 SERVO (330 do)"
MANUAL_CLOSE_MESSAGE = "TU DONG: TIEP TUC"
# Regex nhan dien mo thu cong ca 3 servo (nhan nut vat ly GPIO22 tren ESP32-C6)
# Khop moi goc do: (330 do), (180 do), hoac khong co goc, khong phan biet hoa/thuong
MANUAL_OPEN_PATTERN = re.compile(
    r"^THU\s+CONG:\s*MO\s+CA\s+3\s+SERVO(?:\s*\([^)]*\))?$",
    re.IGNORECASE,
)
# Regex nhan dien dong tu dong / tiep tuc (nha nut vat ly GPIO22 tren ESP32-C6)
MANUAL_CLOSE_PATTERN = re.compile(
    r"^TU\s+DONG:\s*TIEP\s+TUC$",
    re.IGNORECASE,
)
LID_ERROR_OPEN_MESSAGE = "loi mo nap"
LID_ERROR_CLOSE_MESSAGE = "loi dong nap"
LID_ERROR_MESSAGES = frozenset({LID_ERROR_OPEN_MESSAGE, LID_ERROR_CLOSE_MESSAGE})

# Luu tru trang thai doc cam bien doc lap cho tung HC:
# {"fillPercent": int, "updatedAtEpoch": float}
sensor_state = {
    "hc1": None,
    "hc2": None,
    "hc3": None
}
_serial_buffer = ""
collection_session_open = False
active_collection_session_id = None
_pending_collection_events = []
try:
    _initial_state = read_yolo_state()
    _initial_events = _initial_state.get('collectionEvents', [])
    if isinstance(_initial_events, list):
        _pending_collection_events = [
            ev for ev in _initial_events
            if isinstance(ev, dict) and ev.get('eventId')
        ]
except Exception:
    _pending_collection_events = []
backend_connected = True
lid_alert = False
last_lid_error = None


def is_backend_connected():
    if callable(backend_connected):
        return bool(backend_connected())
    return bool(backend_connected)


def reset_collection_session_state():
    global collection_session_open, active_collection_session_id, _pending_collection_events, backend_connected
    collection_session_open = False
    active_collection_session_id = None
    _pending_collection_events = []
    backend_connected = True


def reset_lid_alert_state():
    global lid_alert, last_lid_error
    lid_alert = False
    last_lid_error = None


def normalize_lid_serial_line(line: str) -> str:
    """
    Chuẩn hóa toàn diện chuỗi Serial nhận từ ESP32-C6:
    - Loại bỏ null bytes (\x00), ký tự điều khiển ASCII (\x00-\x1f, \x7f).
    - Chuẩn hóa Unicode NFD để bóc tách dấu tiếng Việt (nếu có).
    - Loại bỏ dấu ngoặc tiền tố phổ biến như [esp32] hoặc esp32:.
    - Chuyển thành chữ thường và thu gọn khoảng trắng thừa.
    """
    if not line or not isinstance(line, str):
        return ""
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", line)
    # Bóc tách dấu tiếng Việt
    cleaned = unicodedata.normalize('NFD', cleaned)
    cleaned = "".join(c for c in cleaned if unicodedata.category(c) != 'Mn')
    cleaned = cleaned.replace("đ", "d").replace("Đ", "d")
    cleaned = cleaned.strip().lower()
    # Loại bỏ tiền tố [esp32] hoặc esp32: nếu có
    cleaned = re.sub(r"^\[esp32\]\s*", "", cleaned)
    cleaned = re.sub(r"^esp32:\s*", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def handle_lid_error_line(line: str, raw_line: str = None) -> bool:
    global lid_alert, last_lid_error
    if not line or not isinstance(line, str):
        return False

    raw_data_str = repr(raw_line) if raw_line is not None else repr(line)
    decoded_str = line
    normalized_str = normalize_lid_serial_line(line)

    matched = None
    if normalized_str in LID_ERROR_MESSAGES:
        matched = normalized_str
    else:
        for err_msg in sorted(LID_ERROR_MESSAGES, key=len, reverse=True):
            if err_msg in normalized_str:
                matched = err_msg
                break

    is_detected = matched is not None
    if is_detected:
        lid_alert = True
        last_lid_error = matched

    # In log 5 gia tri theo yeu cau Buoc 1
    if is_detected or "loi" in normalized_str or "nap" in normalized_str:
        print(f"[SERIAL PARSER DEBUG] 1. Raw data: {raw_data_str}")
        print(f"[SERIAL PARSER DEBUG] 2. Decoded: {decoded_str}")
        print(f"[SERIAL PARSER DEBUG] 3. Normalized: {normalized_str}")
        print(f"[SERIAL PARSER DEBUG] 4. Condition match: {is_detected} (matched='{matched}')")
        print(f"[SERIAL PARSER DEBUG] 5. lid_alert value: {lid_alert}")
        if is_detected:
            print(f"[LID ALERT] DETECTED: {matched}")
            print("[LID ALERT] FLAG SET: True")
            logger.warning("CANH BAO: Phat hien loi nap tu ESP32: %s (matched: %s)", line, matched)

    return is_detected


def get_pending_collection_events():
    return list(_pending_collection_events)


def create_collection_event(event_type, session_id, occurred_at=None):
    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "eventId": str(uuid.uuid4()),
        "sessionId": session_id,
        "stationId": STATION_ID,
        "triggerSource": COLLECTION_SOURCE,
        "eventType": event_type,
        "occurredAt": occurred_at if occurred_at is not None else now_iso,
    }


def normalize_collection_serial_line(line) -> str:
    """
    Chuẩn hóa chuỗi Serial nhận từ ESP32-C6 cho sự kiện thu gom:
    - Hỗ trợ cả str hoặc bytes.
    - Loại bỏ null bytes (\x00), ký tự điều khiển ASCII (\x00-\x1f, \x7f), \r, \n.
    - Loại bỏ tiền tố [esp32] hoặc esp32: nếu có.
    - Chuẩn hóa khoảng trắng thừa.
    """
    if line is None:
        return ""
    if isinstance(line, (bytes, bytearray)):
        line = line.decode("utf-8", errors="ignore")
    elif not isinstance(line, str):
        line = str(line)

    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", line)
    cleaned = cleaned.strip()
    cleaned = re.sub(r"^\[esp32\]\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^esp32:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def is_collection_open_message(line) -> bool:
    cleaned = normalize_collection_serial_line(line)
    return bool(MANUAL_OPEN_PATTERN.match(cleaned))


def is_collection_close_message(line) -> bool:
    cleaned = normalize_collection_serial_line(line)
    return bool(MANUAL_CLOSE_PATTERN.match(cleaned))


def handle_collection_serial_line(line):
    global collection_session_open, active_collection_session_id, _pending_collection_events

    cleaned = normalize_collection_serial_line(line)
    if not cleaned:
        return None

    if is_collection_open_message(cleaned):
        if collection_session_open:
            logger.warning("[Station A Collection] Ignoring duplicate manual open message while Station A is already open.")
            return None
        collection_session_open = True
        if not is_backend_connected():
            active_collection_session_id = None
            logger.warning("[Station A Collection] Backend is disconnected; skipping online OPEN collection event creation.")
            return None
        session_id = str(uuid.uuid4())
        active_collection_session_id = session_id
        event = create_collection_event("OPEN", session_id=session_id)
        _pending_collection_events.append(event)
        print(f"[COLLECTION DEBUG] [OPEN DETECTED] Line: '{cleaned}' | Assigned sessionId: {session_id}")
        logger.info(f"[Station A Collection] [PHYSICAL BUTTON] Detected OPEN: sessionId={session_id} from line='{cleaned}'")
        return event

    if is_collection_close_message(cleaned):
        if not collection_session_open:
            logger.warning("[Station A Collection] Ignoring manual close message without an active open collection session.")
            return None
        collection_session_open = False
        session_id = active_collection_session_id
        active_collection_session_id = None
        if not session_id or not is_backend_connected():
            logger.warning("[Station A Collection] Backend disconnected or open session was not recorded; skipping online CLOSE event.")
            return None
        event = create_collection_event("CLOSE", session_id=session_id)
        _pending_collection_events.append(event)
        print(f"[COLLECTION DEBUG] [CLOSE DETECTED] Line: '{cleaned}' | Matched sessionId: {session_id}")
        logger.info(f"[Station A Collection] [PHYSICAL BUTTON] Detected CLOSE: sessionId={session_id} from line='{cleaned}'")
        return event

    return None


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
            raw_chunk_line, _serial_buffer = _serial_buffer.split("\n", 1)
            line = raw_chunk_line.strip()
            if not line:
                continue

            print("[ESP32]", line)

            # 1. Kiem tra canh bao loi nap thung rac tu ESP32
            if handle_lid_error_line(line, raw_line=raw_chunk_line):
                continue

            # 2. Khop mau cam bien: HC1: <int>%, HC2: <int>%, HC3: <int>%
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
                continue

            handle_collection_serial_line(line)

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


def _publish_state_safely(
    detection=None,
    status="RUNNING",
    camera="CONNECTED",
    sensors=None,
    collection_events=None,
    lid_alert_val=None
):
    global _pending_collection_events, lid_alert
    try:
        acked_ids = get_acknowledged_backend_event_ids()
        if acked_ids and _pending_collection_events:
            _pending_collection_events = [
                ev for ev in _pending_collection_events
                if ev.get("eventId") not in acked_ids
            ]

        kwargs = {
            "detection": detection,
            "status": status,
            "camera": camera
        }
        if sensors is not None:
            kwargs["sensors"] = sensors
        events_to_publish = (
            collection_events
            if collection_events is not None
            else (_pending_collection_events if _pending_collection_events else None)
        )
        if events_to_publish is not None:
            kwargs["collection_events"] = events_to_publish

        active_lid_alert = lid_alert_val if lid_alert_val is not None else lid_alert
        if active_lid_alert:
            kwargs["lid_alert"] = True
            logger.info("[LID ALERT] Publishing to IPC state: lidAlert=True")

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
            camera="DISCONNECTED",
            collection_events=_pending_collection_events if _pending_collection_events else None
        )
        print("[SYSTEM] Da dong camera va USB Serial.")


if __name__ == "__main__":
    main()
