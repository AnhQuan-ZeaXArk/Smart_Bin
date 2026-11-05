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
from datetime import datetime, timezone
from pathlib import Path

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
from smartbin_yolo_bridge import read_yolo_state

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
SOCKET_RETRY_INITIAL_SEC = 2.0
SOCKET_RETRY_MAX_SEC = 60.0
_socket_retry_delay = SOCKET_RETRY_INITIAL_SEC
_next_socket_retry_at = 0.0
_socket_connect_lock = threading.Lock()

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
    global _next_socket_retry_at
    logger.warning("Đã ngắt kết nối khỏi Socket.IO Server. Đang tự động kết nối lại...")
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

    payload = {
        'deviceId': DEVICE_ID,
        'deviceName': DEVICE_NAME,
        'status': 'ONLINE',
        'uptimeSeconds': uptime,
        'cpuTempC': cpu_temp,
        'firmwareVersion': FIRMWARE_VERSION,
        'ipAddress': local_ip,
        'sentAt': sent_at,
        'subsystems': subsystems_payload,
        'metadata': {
            'platform': 'Raspberry Pi 5 (Debian 13 ARM64)'
        }
    }
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
                fill_pct = reading.get('fillPercent')
                epoch = reading.get('updatedAtEpoch')
                if isinstance(fill_pct, int) and not isinstance(fill_pct, bool) and 0 <= fill_pct <= 100:
                    iso_ts = None
                    if isinstance(epoch, (int, float)) and not isinstance(epoch, bool):
                        iso_ts = datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
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


def send_telemetry():
    """Gửi gói tin Telemetry lên Backend qua Socket.IO hoặc HTTP fallback."""
    payload = build_telemetry_payload()

    # 1. Ưu tiên gửi qua Socket.IO
    if sio and sio.connected:
        try:
            sio.emit('device:telemetry', payload)
            logger.info(
                "Socket.IO telemetry -> uptime: %ss | temp: %s°C | Subsystems: [YOLO: %s, Cam: %s]",
                payload['uptimeSeconds'],
                payload['cpuTempC'],
                payload['subsystems']['yolo'],
                payload['subsystems']['camera']
            )
            return True
        except Exception as e:
            logger.error("Socket.IO telemetry emit failed (%s).", type(e).__name__)

    # 2. Fallback qua HTTP POST nếu Socket.IO chưa kết nối
    if requests and DEVICE_INGEST_TOKEN:
        try:
            url = f"{SERVER_URL}/api/demo/device-heartbeat"
            headers = {
                'Authorization': f'Bearer {DEVICE_INGEST_TOKEN}',
                'Content-Type': 'application/json'
            }
            resp = requests.post(url, json=payload, headers=headers, timeout=5)
            if resp.status_code == 200:
                logger.info("Fallback HTTP Heartbeat thành công -> uptime: %ss | temp: %s°C", payload['uptimeSeconds'], payload['cpuTempC'])
                return True
            else:
                logger.warning("Fallback HTTP heartbeat returned status %s.", resp.status_code)
        except Exception as e:
            logger.warning("Fallback HTTP heartbeat failed (%s).", type(e).__name__)

    return False


def handle_exit(signum, frame):
    """Dừng tiến trình và các driver an toàn."""
    global running
    logger.info("Đang dừng Pi Agent và các hệ thống con...")
    running = False

    if sio and sio.connected:
        try:
            sio.disconnect()
        except Exception:
            pass

    release_pid_lock()
    logger.info("Pi Agent đã dừng hoàn tất.")
    sys.exit(0)


def main():
    """Hàm khởi động chính của SmartBin Pi Agent."""
    global running
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
