#!/usr/bin/env python3
"""
SmartBin Raspberry Pi 5 Agent (Debian 13 ARM64)
Reports Raspberry Pi status and read-only YOLO IPC data to the Backend:
1. Giao tiếp thời gian thực hai chiều với Backend qua Socket.IO (Bearer auth qua DEVICE_INGEST_TOKEN).
2. The existing YOLO process owns the camera and inference; the Agent only reads IPC.
3. ESP32 serial is not used by the Agent.
4. Socket.IO retries do not start or stop local YOLO.
6. Cơ chế chống chạy tiến trình trùng lặp (PID lock file).
7. Xử lý an toàn tín hiệu dừng (SIGINT, SIGTERM) và dọn dẹp tài nguyên.
"""

import os
import sys
import time
import signal
import logging
import threading
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List

# Nạp biến môi trường từ .env
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent / '.env'
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
    else:
        load_dotenv()
except ImportError:
    pass

try:
    import requests
except ImportError:
    requests = None

try:
    import socketio
except ImportError:
    socketio = None

# Import giao diện đọc trạng thái YOLO; Agent không điều khiển camera hoặc ESP32.
from smartbin_yolo_bridge import (
    get_acknowledged_backend_event_ids,
    get_confirmed_backend_open_sessions,
    read_yolo_state,
    record_backend_ack,
    record_dropped_offline_event,
)
from station_b_worker import StationBSerialWorker
from offline_buffer import OfflineBuffer

# Cấu hình logging bảo mật (không ghi token)
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [SmartBin-Pi5] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('SmartBin-Pi5')

# Cấu hình thông số từ biến môi trường
SERVER_URL = os.getenv('SERVER_URL', 'https://smartbin-api-e08b.onrender.com').rstrip('/')
DEVICE_ID = 'raspberry-pi-5'
DEVICE_NAME = os.getenv('DEVICE_NAME', 'Raspberry Pi 5 Gateway').strip()
FIRMWARE_VERSION = os.getenv('FIRMWARE_VERSION', '1.0.0').strip()
DEVICE_INGEST_TOKEN = os.getenv('DEVICE_INGEST_TOKEN', '').strip()
TELEMETRY_INTERVAL = max(5, min(60, int(os.getenv('TELEMETRY_INTERVAL', '5'))))

PID_FILE = Path(os.getenv('PID_FILE_PATH', '/tmp/smartbin_agent.pid'))

configured_device_id = os.getenv('DEVICE_ID', DEVICE_ID).strip()
if configured_device_id != DEVICE_ID:
    logger.warning("Ignoring configured DEVICE_ID; the required value is %s.", DEVICE_ID)

# Biến cờ điều khiển
running = True
start_time = time.time()
station_b_worker: Optional[StationBSerialWorker] = None
offline_buffer: Optional[OfflineBuffer] = None
SOCKET_RETRY_INITIAL_SEC = 2.0
SOCKET_RETRY_MAX_SEC = 60.0
_socket_retry_delay = SOCKET_RETRY_INITIAL_SEC
_next_socket_retry_at = 0.0
_socket_connect_lock = threading.Lock()

COLLECTION_EVENT_SOCKET_NAME = 'device:collection:event'
LID_ALERT_SOCKET_NAME = 'device:lid:alert'
LID_ALERT_MESSAGE = 'CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC!'
_seen_collection_event_ids: set[str] = set(get_acknowledged_backend_event_ids())
_confirmed_open_sessions: set[str] = set(get_confirmed_backend_open_sessions())
_lid_alert_emitted: bool = False
_last_emitted_lid_event_id: Optional[str] = None


def reset_online_collection_state():
    """Reset in-memory online collection event state (used by unit tests)."""
    global _lid_alert_emitted, _last_emitted_lid_event_id
    _seen_collection_event_ids.clear()
    _seen_collection_event_ids.update(get_acknowledged_backend_event_ids())
    _confirmed_open_sessions.clear()
    _confirmed_open_sessions.update(get_confirmed_backend_open_sessions())
    _lid_alert_emitted = False
    _last_emitted_lid_event_id = None

# Connection attempts are scheduled by the main loop, not Socket.IO's background
# reconnect thread, so initial failures and disconnects share one retry policy.
if socketio:
    sio = socketio.Client(
        reconnection=False,
        logger=False,
        engineio_logger=False
    )
else:
    sio = None


def sio_event(func):
    if sio:
        return sio.event(func)
    return func


def sio_on(event_name):
    def decorator(func):
        if sio:
            return sio.on(event_name)(func)
        return func
    return decorator


def acquire_pid_lock():
    """Kiểm tra và tạo PID file để chống khởi động nhiều tiến trình trùng lặp."""
    try:
        if PID_FILE.exists():
            old_pid = PID_FILE.read_text().strip()
            # Kiểm tra xem tiến trình cũ có còn sống không
            if old_pid.isdigit():
                pid_int = int(old_pid)
                try:
                    os.kill(pid_int, 0)
                    logger.warning("Tiến trình SmartBin Pi Agent khác đang chạy với PID: %s. Hủy khởi động trùng lặp.", pid_int)
                    sys.exit(0)
                except OSError:
                    # PID cũ không còn tồn tại -> Stale PID file, cho phép ghi đè
                    pass

        PID_FILE.write_text(str(os.getpid()))
    except Exception as e:
        logger.debug("Không thể tạo PID file tại %s: %s", PID_FILE, e)


def release_pid_lock():
    """Xóa file PID khi thoát chương trình."""
    try:
        if PID_FILE.exists():
            PID_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def get_uptime_seconds() -> int:
    """Lấy thời gian hoạt động hệ thống từ /proc/uptime (Debian Linux)."""
    try:
        with open('/proc/uptime', 'r', encoding='utf-8') as f:
            uptime_str = f.readline().split()[0]
            return int(float(uptime_str))
    except Exception:
        return int(time.time() - start_time)


def get_cpu_temp_c() -> float | None:
    """Lấy nhiệt độ CPU thực tế từ thermal_zone0 trên Raspberry Pi 5."""
    thermal_file = '/sys/class/thermal/thermal_zone0/temp'
    try:
        if os.path.exists(thermal_file):
            with open(thermal_file, 'r', encoding='utf-8') as f:
                raw_val = f.read().strip()
                return round(float(raw_val) / 1000.0, 1)
    except Exception as e:
        logger.debug("Không thể đọc thermal zone: %s", e)
    return None


def get_local_ip() -> str | None:
    """Lấy địa chỉ IP mạng nội bộ của Raspberry Pi 5."""
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


@sio_event
def connect():
    """Sự kiện khi kết nối Socket.IO thành công."""
    logger.info("Đã kết nối thành công tới SmartBin Socket.IO Server: %s", SERVER_URL)
    logger.info("Thiết bị '%s' đã tự động gia nhập room 'device' và 'device:%s'", DEVICE_ID, DEVICE_ID)


@sio_event
def connect_error(data):
    """Sự kiện lỗi kết nối."""
    logger.warning("Socket.IO connection failed; the agent will retry with backoff.")


@sio_event
def disconnect():
    """Sự kiện mất kết nối Socket.IO."""
    global _next_socket_retry_at, _lid_alert_emitted, _last_emitted_lid_event_id
    logger.warning("Đã ngắt kết nối khỏi Socket.IO Server. Đang tự động kết nối lại...")
    _lid_alert_emitted = False
    _last_emitted_lid_event_id = None
    _next_socket_retry_at = time.monotonic() + _socket_retry_delay


@sio_on('realtime:connected')
def on_realtime_connected(data):
    """Server xác nhận hoàn tất bắt tay (handshake)."""
    logger.info("Xác nhận phiên kết nối realtime: %s", data)


@sio_on('device:command')
def on_device_command(payload):
    """
    Chỉ xử lý PING; mọi lệnh khác bị từ chối mà không truy cập phần cứng.
    """
    if not isinstance(payload, dict):
        logger.warning("Nhận lệnh không đúng định dạng: %s", payload)
        return

    command_id = payload.get('commandId')
    action = payload.get('action')
    if not isinstance(command_id, str) or not command_id.strip() \
            or not isinstance(action, str) or not action.strip():
        logger.warning("Nhận lệnh thiếu commandId hoặc action hợp lệ.")
        return

    logger.info(">>> Nhận lệnh từ Web: action='%s' (commandId=%s)", action, command_id)

    if action == 'PING':
        cpu_temp = get_cpu_temp_c()
        uptime = get_uptime_seconds()
        yolo_info = read_yolo_state()

        ack = {
            'commandId': command_id,
            'deviceId': DEVICE_ID,
            'action': 'PING',
            'status': 'COMPLETED',
            'message': 'Pong! Raspberry Pi 5 phản hồi lệnh PING thành công.',
            'result': {
                'cpuTempC': cpu_temp,
                'uptimeSeconds': uptime,
                'platform': 'Raspberry Pi 5 (Debian 13 ARM64)',
                'subsystems': {
                    'yolo': yolo_info.get('yoloStatus'),
                    'camera': yolo_info.get('cameraStatus')
                },
                'timestamp': datetime.now(timezone.utc).isoformat()
            },
            'executedAt': datetime.now(timezone.utc).isoformat()
        }
        if sio:
            sio.emit('device:command:ack', ack)
        logger.info("<<< Hoàn tất lệnh PING và gửi ACK COMPLETED")

    else:
        ack = {
            'commandId': command_id,
            'deviceId': DEVICE_ID,
            'action': action,
            'status': 'FAILED',
            'message': f"Lệnh '{action}' không được phép thực thi trong giai đoạn này. Chỉ cho phép PING.",
            'error': 'ACTION_NOT_PERMITTED',
            'executedAt': datetime.now(timezone.utc).isoformat()
        }
        if sio:
            sio.emit('device:command:ack', ack)
        logger.warning("<<< Lệnh '%s' bị từ chối do chính sách an toàn phần cứng.", action)


def normalize_fill_level(value: Any) -> Optional[int]:
    """
    Safely normalize fill level to an integer between 0 and 100.
    - Accepts int, finite float, numeric strings (e.g. '45', '45.7', '45%').
    - Rejects booleans (True/False).
    - Rejects None, NaN, Infinity, empty strings, non-numeric strings.
    - Rejects values < 0 or > 100.
    - Normalizes accepted values to int using round().
    - Returns None if invalid (never converts invalid or missing data to 0).
    """
    if value is None or isinstance(value, bool):
        return None

    num: float
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            return None
        num = float(value)
    elif isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        if cleaned.endswith('%'):
            cleaned = cleaned[:-1].strip()
        try:
            num = float(cleaned)
            if not math.isfinite(num):
                return None
        except (ValueError, TypeError):
            return None
    else:
        return None

    if 0.0 <= num <= 100.0:
        return int(round(num))
    return None


def build_telemetry_payload() -> dict:
    """Tập hợp gói tin Telemetry đầy đủ từ tất cả các subsystem."""
    uptime = get_uptime_seconds()
    cpu_temp = get_cpu_temp_c()
    local_ip = get_local_ip()
    sent_at = datetime.now(timezone.utc).isoformat()

    # Read-only IPC access; YOLO owns its camera and inference process.
    yolo_info = read_yolo_state()

    subsystems_payload = {
        'yolo': yolo_info.get('yoloStatus', 'STOPPED'),
        'camera': yolo_info.get('cameraStatus', 'DISCONNECTED')
    }

    ai_detection_payload = yolo_info.get('latestDetection')
    lid_alert = bool(yolo_info.get('lidAlert', False))
    lid_alert_id = yolo_info.get('lidAlertId')
    lid_alert_timestamp = yolo_info.get('lidAlertTimestamp')
    if lid_alert:
        print("[LID ALERT] IPC VALUE: True")
        logger.info("[LID ALERT] IPC VALUE: True")

    payload = {
        'stationCode': 'STATION_A',
        'deviceId': DEVICE_ID,
        'deviceName': DEVICE_NAME,
        'status': 'ONLINE',
        'uptimeSeconds': uptime,
        'cpuTempC': cpu_temp,
        'firmwareVersion': FIRMWARE_VERSION,
        'ipAddress': local_ip,
        'sentAt': sent_at,
        'clientMessageId': f"STATION_A-{uptime}-{int(time.time() * 1000)}",
        'subsystems': subsystems_payload,
        'lidAlert': lid_alert,
        'metadata': {
            'platform': 'Raspberry Pi 5 (Debian 13 ARM64)',
            'lidAlert': lid_alert
        }
    }
    if lid_alert_id:
        payload['lidAlertId'] = lid_alert_id
        payload['metadata']['lidAlertId'] = lid_alert_id
    if lid_alert_timestamp:
        payload['lidAlertTimestamp'] = lid_alert_timestamp
        payload['metadata']['lidAlertTimestamp'] = lid_alert_timestamp
    if ai_detection_payload is not None:
        payload['aiDetection'] = ai_detection_payload
    if yolo_info.get('lastInferenceTimeMs') is not None:
        payload['metadata']['lastInferenceMs'] = yolo_info['lastInferenceTimeMs']

    sensors_info = yolo_info.get('sensors')
    if sensors_info and isinstance(sensors_info, dict):
        mapping = {
            'hc1': 'recyclable',
            'hc2': 'nonRecyclable',
            'hc3': 'organic'
        }
        sensors_payload = {}
        for hc_key, compartment_key in mapping.items():
            reading = sensors_info.get(hc_key)
            if reading and isinstance(reading, dict):
                raw_fill = reading.get('fillPercent')
                fill_pct = normalize_fill_level(raw_fill)
                epoch = reading.get('updatedAtEpoch')
                if fill_pct is not None:
                    iso_ts = None
                    if isinstance(epoch, (int, float)) and not isinstance(epoch, bool) and math.isfinite(epoch):
                        sec_epoch = float(epoch) / 1000.0 if float(epoch) > 1e11 else float(epoch)
                        iso_ts = datetime.fromtimestamp(sec_epoch, tz=timezone.utc).isoformat()
                    sensors_payload[compartment_key] = {
                        'fillLevel': fill_pct,
                        'distanceCm': None,
                        'status': 'OK',
                        'updatedAt': iso_ts
                    }
        if sensors_payload:
            payload['sensors'] = sensors_payload

    return payload


def ensure_socket_connection(now: float | None = None) -> bool:
    """Make one due Socket.IO connection attempt, backing off on transient failures."""
    global _socket_retry_delay, _next_socket_retry_at
    if not sio or not DEVICE_INGEST_TOKEN:
        return False
    if sio.connected:
        return True

    current_time = time.monotonic() if now is None else now
    if current_time < _next_socket_retry_at:
        return False
    if not _socket_connect_lock.acquire(blocking=False):
        return False

    try:
        if sio.connected:
            return True
        try:
            sio.connect(
                SERVER_URL,
                auth={
                    'type': 'device',
                    'token': DEVICE_INGEST_TOKEN,
                    'deviceId': DEVICE_ID
                },
                transports=['websocket', 'polling'],
                wait_timeout=5
            )
        except Exception as error:
            logger.warning(
                "Socket.IO connection attempt failed (%s); retrying with backoff.",
                type(error).__name__
            )
            retry_base_time = current_time if now is not None else time.monotonic()
            _next_socket_retry_at = retry_base_time + _socket_retry_delay
            _socket_retry_delay = min(_socket_retry_delay * 2, SOCKET_RETRY_MAX_SEC)
            return False

        if not sio.connected:
            retry_base_time = current_time if now is not None else time.monotonic()
            _next_socket_retry_at = retry_base_time + _socket_retry_delay
            _socket_retry_delay = min(_socket_retry_delay * 2, SOCKET_RETRY_MAX_SEC)
            return False

        _socket_retry_delay = SOCKET_RETRY_INITIAL_SEC
        _next_socket_retry_at = 0.0
        return True
    finally:
        _socket_connect_lock.release()


def drain_offline_buffer():
    """
    Dọn và gửi tuần tự các gói tin đệm ngoại tuyến khi có mạng trở lại.
    QUY TẮC BẤT BIẾN: Chỉ đánh dấu ACKED và prune khỏi SQLite SAU KHI nhận
    xác nhận ACK thành công từ Backend qua callback Socket.IO.
    """
    if not offline_buffer or not sio or not sio.connected:
        return

    batch = offline_buffer.peek_batch(limit=10)
    if not batch:
        return

    # Đánh dấu các gói đang xử lý
    batch_ids = [item['id'] for item in batch]
    offline_buffer.mark_in_flight(batch_ids)

    for item in batch:
        msg_id = item['client_message_id']
        try:
            payload = json.loads(item['payload_json'])
        except Exception as err:
            logger.error("Dữ liệu payload hỏng cho gói %s: %s", msg_id, err)
            offline_buffer.mark_acked([msg_id])
            offline_buffer.prune_acked()
            continue

        ack_received = threading.Event()
        ack_result = {'success': False, 'data': None}

        def on_ack(response=None):
            ack_result['data'] = response
            if isinstance(response, dict) and response.get('success'):
                ack_result['success'] = True
            elif response is True:
                ack_result['success'] = True
            ack_received.set()

        try:
            # Gửi gói tin kèm callback xác nhận
            sio.emit('device:telemetry', payload, callback=on_ack)

            # Chờ xác nhận từ Backend với thời gian chờ tối đa 5 giây
            if ack_received.wait(timeout=5.0):
                if ack_result['success']:
                    offline_buffer.mark_acked([msg_id])
                    offline_buffer.prune_acked()
                    logger.info("Backend đã xác nhận ACK & Commit dữ liệu cho gói %s: %s", msg_id, ack_result['data'])
                else:
                    logger.warning("Backend từ chối gói %s: %s -> Giữ lại trong buffer", msg_id, ack_result['data'])
                    offline_buffer.mark_failed([msg_id])
            else:
                logger.warning("Timeout 5s chờ ACK cho gói %s -> Giữ lại trong buffer để thử lại", msg_id)
                offline_buffer.mark_failed([msg_id])
                break # Mạng có thể không ổn định, dừng lô hiện tại
        except Exception as e:
            logger.warning("Lỗi phát Socket.IO cho gói %s: %s -> Giữ lại", msg_id, e)
            offline_buffer.mark_failed([msg_id])
            break


def process_online_collection_events(yolo_info: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Gửi trực tuyến các sự kiện thu gom thủ công tại Trạm A qua Socket.IO.
    QUY TẮC BẮT BUỘC:
    - Pi Agent chỉ đánh dấu event đã xử lý sau khi Backend ACK thành công.
    - Khi timeout (>10s) hoặc mất kết nối, sự kiện được giữ lại trong hàng đợi để gửi lại.
    - Backend bảo đảm tính Idempotent theo eventId, không tạo bản ghi trùng lặp.
    - Nếu sự kiện OPEN chưa được Backend xác nhận, giữ lại sự kiện CLOSE để thử lại sau khi OPEN thành công.
    """
    info = yolo_info if isinstance(yolo_info, dict) else read_yolo_state()
    raw_events = info.get('collectionEvents')
    if not isinstance(raw_events, list) or not raw_events:
        return []

    results: List[Dict[str, Any]] = []
    is_connected = bool(sio and sio.connected)

    for ev in raw_events:
        if not isinstance(ev, dict):
            continue
        ev_id = ev.get('eventId')
        sess_id = ev.get('sessionId')
        ev_type = ev.get('eventType')
        if not isinstance(ev_id, str) or not ev_id.strip():
            continue
        ev_id = ev_id.strip()

        # Đã được Backend ACK thành công trước đó thì bỏ qua
        if ev_id in _seen_collection_event_ids:
            continue

        if not is_connected:
            print(f"[COLLECTION AGENT] Socket.IO đang ngắt kết nối. Giữ sự kiện {ev_type} (eventId={ev_id}) để gửi lại khi có mạng.")
            logger.warning(
                "[Station A Collection] Tạm hoãn sự kiện %s (eventId=%s, sessionId=%s) do Socket.IO đang mất kết nối. Giữ lại để gửi lại khi kết nối lại.",
                ev_type,
                ev_id,
                sess_id
            )
            results.append({'eventId': ev_id, 'sessionId': sess_id, 'eventType': ev_type, 'saved': False, 'reason': 'OFFLINE'})
            continue

        if ev_type == 'CLOSE' and (not isinstance(sess_id, str) or sess_id not in _confirmed_open_sessions):
            print(f"[COLLECTION AGENT] Chưa gửi CLOSE (sessionId={sess_id}) do OPEN chưa được Backend xác nhận. Giữ lại trong hàng đợi.")
            logger.warning(
                "[Station A Collection] Chưa thể gửi sự kiện CLOSE (eventId=%s, sessionId=%s) vì sự kiện OPEN chưa được Backend xác nhận lưu thành công. Giữ lại để thử lại.",
                ev_id,
                sess_id
            )
            results.append({'eventId': ev_id, 'sessionId': sess_id, 'eventType': ev_type, 'saved': False, 'reason': 'OPEN_NOT_CONFIRMED'})
            continue

        ack_received = threading.Event()
        ack_holder: Dict[str, Any] = {'success': False, 'response': None}

        def on_collection_ack(response=None):
            ack_holder['response'] = response
            if isinstance(response, dict) and bool(response.get('success')) and response.get('eventId') == ev_id:
                ack_holder['success'] = True
            ack_received.set()

        payload = {
            'eventId': ev_id,
            'sessionId': sess_id,
            'stationId': ev.get('stationId', 'station_a'),
            'triggerSource': ev.get('triggerSource', 'PHYSICAL_BUTTON'),
            'eventType': ev_type,
            'occurredAt': ev.get('occurredAt')
        }

        try:
            print(f"[COLLECTION AGENT] Nhận sự kiện từ IPC: {ev_type} | eventId={ev_id} | sessionId={sess_id}")
            print(f"[COLLECTION AGENT] Đang gửi sự kiện {ev_type} lên Backend (timeout 10s)...")
            sio.emit(COLLECTION_EVENT_SOCKET_NAME, payload, callback=on_collection_ack)
            # Timeout 10.0s đảm bảo chịu được độ trễ mạng và transaction PostgreSQL trên Render
            if ack_received.wait(timeout=10.0) and ack_holder['success']:
                # CHỈ ĐÁNH DẤU ĐÃ XỬ LÝ KHI BACKEND ACK THÀNH CÔNG!
                _seen_collection_event_ids.add(ev_id)
                record_backend_ack(ev_id, sess_id, ev_type)
                if ev_type == 'OPEN' and isinstance(sess_id, str):
                    _confirmed_open_sessions.add(sess_id)
                elif ev_type == 'CLOSE' and isinstance(sess_id, str):
                    _confirmed_open_sessions.discard(sess_id)

                print(f"[COLLECTION AGENT] Backend ACK THÀNH CÔNG: {ev_type} | eventId={ev_id} | sessionId={sess_id}")
                logger.info(
                    "[Station A Collection] Backend xác nhận đã lưu sự kiện %s (eventId=%s, sessionId=%s).",
                    ev_type,
                    ev_id,
                    sess_id
                )
                results.append({
                    'eventId': ev_id,
                    'sessionId': sess_id,
                    'eventType': ev_type,
                    'saved': True,
                    'response': ack_holder['response']
                })
            else:
                resp = ack_holder.get('response')
                print(f"[COLLECTION AGENT] Backend ACK thất bại hoặc timeout (>10s) cho {ev_type} (eventId={ev_id}): {resp}. Giữ lại trong hàng đợi để gửi lại!")
                logger.warning(
                    "[Station A Collection] Backend KHÔNG xác nhận lưu sự kiện %s (eventId=%s, sessionId=%s): %s. Giữ lại để thử lại ở chu kỳ sau.",
                    ev_type,
                    ev_id,
                    sess_id,
                    resp
                )
                results.append({
                    'eventId': ev_id,
                    'sessionId': sess_id,
                    'eventType': ev_type,
                    'saved': False,
                    'reason': 'ACK_FAILED',
                    'response': resp
                })
        except Exception as e:
            print(f"[COLLECTION AGENT] Lỗi ngoại lệ khi emit sự kiện {ev_type}: {e}. Giữ lại trong hàng đợi để gửi lại!")
            logger.error(
                "[Station A Collection] Lỗi gửi sự kiện %s (eventId=%s): %s",
                ev_type,
                ev_id,
                type(e).__name__
            )
            results.append({
                'eventId': ev_id,
                'sessionId': sess_id,
                'eventType': ev_type,
                'saved': False,
                'reason': 'EMIT_ERROR',
                'error': str(e)
            })

    return results


def send_telemetry():
    """Gửi gói tin Telemetry lên Backend qua Socket.IO hoặc HTTP fallback cho cả Station A và Station B."""
    # 1. Thu thập dữ liệu Station A
    payload_a = build_telemetry_payload()

    # 1b. Xử lý trực tuyến sự kiện thu gom thủ công tại Trạm A (không lưu ngoại tuyến)
    process_online_collection_events()

    # 2. Thu thập dữ liệu Station B nếu Worker đang hoạt động
    payload_b = None
    if station_b_worker:
        payload_b = station_b_worker.get_latest_data()
        if payload_b:
            payload_b['stationCode'] = 'STATION_B'
            if not payload_b.get('deviceId'):
                payload_b['deviceId'] = 'esp32c6-station-b'
            payload_b['deviceType'] = 'ESP32_C6'
            payload_b['status'] = 'ONLINE'
            if 'uptimeSeconds' not in payload_b:
                uptime_ms = payload_b.get('uptimeMs', 0)
                payload_b['uptimeSeconds'] = round(uptime_ms / 1000.0, 1)
            if not payload_b.get('sentAt'):
                payload_b['sentAt'] = datetime.now(timezone.utc).isoformat()

            # Chuẩn hóa cảm biến Trạm B: map fillPercent/fillLevel an toàn bằng normalize_fill_level
            sensors_b = payload_b.get('sensors')
            if isinstance(sensors_b, dict):
                for comp_key, comp_data in sensors_b.items():
                    if isinstance(comp_data, dict):
                        if comp_data.get('status') == 'NOT_INSTALLED':
                            comp_data['fillLevel'] = None
                            comp_data['fillPercent'] = None
                            comp_data['distanceCm'] = None
                            continue

                        raw_val = comp_data.get('fillLevel') if 'fillLevel' in comp_data else comp_data.get('fillPercent')
                        norm_val = normalize_fill_level(raw_val)
                        if norm_val is not None:
                            comp_data['fillLevel'] = norm_val
                            comp_data['fillPercent'] = norm_val
                            if not comp_data.get('updatedAt'):
                                comp_data['updatedAt'] = payload_b['sentAt']
                        else:
                            comp_data['fillLevel'] = None
                            comp_data['fillPercent'] = None

            sample_seq = payload_b.get('sampleSeq')
            boot_count = payload_b.get('bootCount', 0)
            boot_id = payload_b.get('bootId', 'default')
            if sample_seq is not None:
                msg_id = f"STATION_B-{boot_count}-{sample_seq}-{boot_id}"
            else:
                msg_id = f"STATION_B-{boot_count}-{int(time.time() * 1000)}-{boot_id}"
            payload_b['clientMessageId'] = msg_id

    station_a_sent = False

    # Gửi qua Socket.IO nếu đã kết nối
    if sio and sio.connected:
        # Gửi dữ liệu tồn đọng trong Offline Buffer trước
        drain_offline_buffer()

        # Gửi Station A kèm ACK callback để xác thực trạng thái ghi nhận từ Backend
        a_ack_received = threading.Event()
        a_ack_result = {'success': False, 'data': None}

        def on_a_ack(response=None):
            a_ack_result['data'] = response
            if isinstance(response, dict) and response.get('success'):
                a_ack_result['success'] = True
            elif response is True:
                a_ack_result['success'] = True
            a_ack_received.set()

        try:
            # Phát sự kiện cảnh báo lỗi nắp nếu có (nhận diện theo từng eventId hoặc timestamp để cho phép re-trigger)
            global _lid_alert_emitted, _last_emitted_lid_event_id
            has_lid_alert = bool(payload_a.get('lidAlert'))
            current_lid_id = payload_a.get('lidAlertId')
            current_lid_time = payload_a.get('lidAlertTimestamp') or datetime.now(timezone.utc).isoformat()

            if has_lid_alert:
                if not current_lid_id:
                    current_lid_id = f"lid-alert-{current_lid_time}" if not _last_emitted_lid_event_id else _last_emitted_lid_event_id

                is_new_event = bool(current_lid_id and current_lid_id != _last_emitted_lid_event_id)
                print(f"[PI AGENT DEBUG] payload_a['lidAlert']=True, current_lid_id={current_lid_id}, _last_emitted_lid_event_id={_last_emitted_lid_event_id}, is_new={is_new_event}, socket_connected={sio.connected}")
                logger.info(
                    "[PI AGENT DEBUG] payload_a['lidAlert']=True, current_lid_id=%s, is_new=%s, socket_connected=%s",
                    current_lid_id,
                    is_new_event,
                    sio.connected
                )
                if is_new_event:
                    print(f"[PI AGENT] PRE-EMIT: Sending '{LID_ALERT_SOCKET_NAME}' (eventId={current_lid_id}) to Backend (server={SERVER_URL})...")
                    try:
                        sio.emit(LID_ALERT_SOCKET_NAME, {
                            'eventId': current_lid_id,
                            'timestamp': current_lid_time,
                            'deviceId': DEVICE_ID,
                            'stationCode': 'STATION_A',
                            'message': LID_ALERT_MESSAGE,
                            'lidAlert': True
                        })
                        _last_emitted_lid_event_id = current_lid_id
                        _lid_alert_emitted = True
                        print(f"[LID ALERT] SOCKET EVENT EMITTED: eventId={current_lid_id}")
                        print(f"[PI AGENT] POST-EMIT: Successfully emitted '{LID_ALERT_SOCKET_NAME}', _last_emitted_lid_event_id={_last_emitted_lid_event_id}")
                        logger.warning(
                            "[Station A] [LID ALERT] SOCKET EVENT EMITTED: %s (%s, eventId=%s)",
                            LID_ALERT_SOCKET_NAME,
                            LID_ALERT_MESSAGE,
                            current_lid_id
                        )
                    except Exception as emit_err:
                        print(f"[PI AGENT] EMIT FAILED: {emit_err}")
                        logger.warning("Không thể phát sự kiện %s: %s", LID_ALERT_SOCKET_NAME, emit_err)
                else:
                    print(f"[PI AGENT] EMIT SKIPPED: eventId={current_lid_id} is already emitted")

            sio.emit('device:telemetry', payload_a, callback=on_a_ack)
            if a_ack_received.wait(timeout=3.0):
                resp_data = a_ack_result.get('data') or {}
                ack_status = resp_data.get('status') if isinstance(resp_data, dict) else ('COMMITTED' if a_ack_result['success'] else 'UNKNOWN')
                logger.info(
                    "[Station A] Socket.IO live telemetry ACK -> Status: %s | Success: %s | Sensors: %s",
                    ack_status,
                    a_ack_result['success'],
                    list(payload_a.get('sensors', {}).keys()) if payload_a.get('sensors') else 'None'
                )
            else:
                logger.warning("[Station A] Socket.IO live telemetry ACK timed out sau 3.0s")
            station_a_sent = True
        except Exception as e:
            logger.error("Station A Socket.IO telemetry emit failed (%s).", type(e).__name__)

        # Gửi Station B nếu có dữ liệu mới
        if payload_b:
            msg_id = payload_b.get('clientMessageId') or f"STATION_B-{payload_b.get('bootCount', 0)}-{payload_b.get('sampleSeq', 0)}-{payload_b.get('bootId', 'default')}"

            b_ack_received = threading.Event()
            b_ack_result = {'success': False, 'data': None}

            def on_b_ack(response=None):
                b_ack_result['data'] = response
                if isinstance(response, dict) and response.get('success'):
                    b_ack_result['success'] = True
                elif response is True:
                    b_ack_result['success'] = True
                b_ack_received.set()

            try:
                sio.emit('device:telemetry', payload_b, callback=on_b_ack)
                if b_ack_received.wait(timeout=3.0) and b_ack_result['success']:
                    logger.info(
                        "[Station B] Socket.IO live telemetry ACK OK -> Boot: %s | Seq: %s | Sensors: %s",
                        payload_b.get('bootCount'),
                        payload_b.get('sampleSeq'),
                        list(payload_b.get('sensors', {}).keys())
                    )
                else:
                    logger.warning("[Station B] Live emit ACK failed/timed out -> Lưu vào OfflineBuffer để đảm bảo không mất")
                    if offline_buffer:
                        offline_buffer.enqueue(msg_id, 'STATION_B', 'RECYCLABLE', json.dumps(payload_b))
            except Exception as e:
                logger.error("Station B Socket.IO live emit error (%s) -> Lưu vào buffer", type(e).__name__)
                if offline_buffer:
                    offline_buffer.enqueue(msg_id, 'STATION_B', 'RECYCLABLE', json.dumps(payload_b))

        # Nếu Station A đã gửi thành công qua Socket.IO thì không cần fallback HTTP
        if station_a_sent:
            return True

    # Nếu Socket.IO chưa kết nối: Đệm dữ liệu Station B vào OfflineBuffer
    if payload_b and offline_buffer and not (sio and sio.connected):
        msg_id = payload_b.get('clientMessageId') or f"STATION_B-{payload_b.get('bootCount', 0)}-{payload_b.get('sampleSeq', 0)}-{payload_b.get('bootId', 'default')}"
        offline_buffer.enqueue(msg_id, 'STATION_B', 'RECYCLABLE', json.dumps(payload_b))
        logger.info("Đã lưu gói Station B vào Offline Buffer do mất kết nối.")

    # 3. Fallback qua HTTP POST nếu Socket.IO chưa kết nối hoặc emit Station A thất bại (Chỉ hỗ trợ Station A Legacy Heartbeat)
    if requests and DEVICE_INGEST_TOKEN:
        try:
            url = f"{SERVER_URL}/api/demo/device-heartbeat"
            headers = {
                'Authorization': f'Bearer {DEVICE_INGEST_TOKEN}',
                'Content-Type': 'application/json'
            }
            if payload_a.get('lidAlert'):
                print(f"[PI AGENT HTTP FALLBACK] Sending heartbeat with lidAlert=True to {url}")
                logger.info("[PI AGENT HTTP FALLBACK] Sending heartbeat with lidAlert=True to %s", url)
            resp = requests.post(url, json=payload_a, headers=headers, timeout=5)
            if resp.status_code == 200:
                logger.info("Fallback HTTP Heartbeat thành công -> uptime: %ss | temp: %s°C", payload_a['uptimeSeconds'], payload_a['cpuTempC'])
                return True
            else:
                logger.warning("Fallback HTTP heartbeat returned status %s.", resp.status_code)
        except Exception as e:
            logger.warning("Fallback HTTP heartbeat failed (%s).", type(e).__name__)

    return False


def handle_exit(signum, frame):
    """Dừng tiến trình và các driver an toàn."""
    global running, station_b_worker, offline_buffer
    logger.info("Đang dừng Pi Agent và các hệ thống con...")
    running = False

    if station_b_worker:
        try:
            station_b_worker.stop()
        except Exception:
            pass

    if sio and sio.connected:
        try:
            sio.disconnect()
        except Exception:
            pass

    if offline_buffer:
        try:
            offline_buffer.prune_acked()
        except Exception:
            pass

    release_pid_lock()
    logger.info("Pi Agent đã dừng hoàn tất.")
    sys.exit(0)


def main():
    """Hàm khởi động chính của SmartBin Pi Agent."""
    global running, station_b_worker, offline_buffer
    acquire_pid_lock()

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    logger.info("==================================================")
    logger.info("   SmartBin Raspberry Pi 5 Agent v2.0.0          ")
    logger.info("   Nền tảng: Debian 13 ARM64                     ")
    logger.info("   Device ID: %s", DEVICE_ID)
    logger.info("   Server URL: %s", SERVER_URL)
    logger.info("   Chu kỳ Telemetry: %s giây                     ", TELEMETRY_INTERVAL)
    logger.info("==================================================")

    if not DEVICE_INGEST_TOKEN:
        logger.error("LỖI: Chưa cấu hình DEVICE_INGEST_TOKEN trong biến môi trường hoặc file .env!")
        logger.error("Vui lòng thiết lập DEVICE_INGEST_TOKEN=<token> trước khi chạy.")
        release_pid_lock()
        sys.exit(1)

    # Khởi tạo Offline Buffer SQLite
    db_path = os.getenv('SMARTBIN_OFFLINE_BUFFER_DB')
    offline_buffer = OfflineBuffer(db_path=db_path)

    # Khởi tạo Station B Serial Worker (ESP32-C6)
    enable_station_b = os.getenv('ENABLE_STATION_B', 'true').lower() in ('1', 'true', 'yes')
    if enable_station_b:
        station_b_port = os.getenv('STATION_B_SERIAL_PORT')
        station_b_worker = StationBSerialWorker(port=station_b_port)
        station_b_worker.start()

    # Read-only IPC monitoring; the existing YOLO process owns its camera and inference.
    state_file = os.getenv('SMARTBIN_YOLO_STATE_FILE', '/tmp/smartbin_yolo_state.json')
    logger.info("Chế độ Bridge: Đọc kết quả nhận diện từ yolo_camera.py qua %s...", state_file)

    # Keep the agent alive and retry transient network failures with bounded backoff.
    while running:
        ensure_socket_connection()
        send_telemetry()
        time.sleep(TELEMETRY_INTERVAL)


if __name__ == '__main__':
    main()
