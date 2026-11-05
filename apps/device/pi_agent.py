#!/usr/bin/env python3
"""
SmartBin Raspberry Pi 5 Agent (Debian 13 ARM64)
Quản trị tiến trình & tích hợp phần cứng thực tế:
1. Giao tiếp thời gian thực hai chiều với Backend qua Socket.IO (Bearer auth qua DEVICE_INGEST_TOKEN).
2. Tích hợp mô hình AI YOLO Camera (Rapoo C200 USB Camera) chạy độc lập trong virtualenv.
3. Tích hợp giao tiếp USB Serial với ESP32 (baud rate 115200) đọc cảm biến siêu âm 3 ngăn:
   - RECYCLABLE (Rác tái chế)
   - ORGANIC (Rác hữu cơ)
   - NON_RECYCLABLE (Rác không tái chế)
4. Tự động kiểm tra Camera và ESP32, tự kết nối lại khi thiết bị USB bị rút/cắm.
5. Socket.IO reconnect hoạt động độc lập với AI và Serial process; không dừng YOLO khi mất mạng.
6. Cơ chế chống chạy tiến trình trùng lặp (PID lock file).
7. Xử lý an toàn tín hiệu dừng (SIGINT, SIGTERM) và dọn dẹp tài nguyên.
"""

import os
import sys
import time
import signal
import logging
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

# Import các module phần cứng & cầu nối
from esp32_serial import ESP32SerialReader
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
DEVICE_ID = os.getenv('DEVICE_ID', 'raspberry-pi-5').strip()
DEVICE_NAME = os.getenv('DEVICE_NAME', 'Raspberry Pi 5 Gateway').strip()
FIRMWARE_VERSION = os.getenv('FIRMWARE_VERSION', '1.0.0').strip()
DEVICE_INGEST_TOKEN = os.getenv('DEVICE_INGEST_TOKEN', '').strip()
TELEMETRY_INTERVAL = max(5, min(60, int(os.getenv('TELEMETRY_INTERVAL', '5'))))

PID_FILE = Path(os.getenv('PID_FILE_PATH', '/tmp/smartbin_agent.pid'))

# Khởi tạo driver đọc cảm biến ESP32 Serial
esp32_reader = ESP32SerialReader()

# Biến cờ điều khiển
running = True
start_time = time.time()

# Khởi tạo Socket.IO Client với cấu hình tự động Reconnect độc lập
if socketio:
    sio = socketio.Client(
        reconnection=True,
        reconnection_attempts=0,     # Thử kết nối lại vô hạn
        reconnection_delay=2,        # Thử lại sau 2 giây
        reconnection_delay_max=10,   # Tối đa 10 giây
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
    logger.warning("Kết nối Socket.IO thất bại: %s. Đang tự động kết nối lại trong nền (YOLO và Cảm biến vẫn tiếp tục chạy độc lập)...", data)


@sio_event
def disconnect():
    """Sự kiện mất kết nối Socket.IO."""
    logger.warning("Đã ngắt kết nối khỏi Socket.IO Server. Đang tự động kết nối lại...")


@sio_on('realtime:connected')
def on_realtime_connected(data):
    """Server xác nhận hoàn tất bắt tay (handshake)."""
    logger.info("Xác nhận phiên kết nối realtime: %s", data)


@sio_on('device:command')
def on_device_command(payload):
    """
    Lắng nghe lệnh điều khiển từ SmartBin Web được Backend phân phối tới.
    Chỉ thực thi các lệnh an toàn: PING và TRIGGER_ULTRASONIC.
    Tuyệt đối từ chối các lệnh can thiệp nắp/servo hoặc reboot chưa kiểm chứng.
    """
    if not isinstance(payload, dict):
        logger.warning("Nhận lệnh không đúng định dạng: %s", payload)
        return

    command_id = payload.get('commandId', '')
    action = payload.get('action', '')

    logger.info(">>> Nhận lệnh từ Web: action='%s' (commandId=%s)", action, command_id)

    # 1. Gửi phản hồi ACK trạng thái RECEIVED ngay lập tức
    ack_received = {
        'commandId': command_id,
        'deviceId': DEVICE_ID,
        'action': action,
        'status': 'RECEIVED',
        'message': f"Raspberry Pi 5 đã nhận lệnh {action}"
    }
    if sio:
        sio.emit('device:command:ack', ack_received)

    # 2. Xử lý lệnh: Chỉ duy trì PING cho kiểm tra trạng thái thiết bị
    if action == 'PING':
        cpu_temp = get_cpu_temp_c()
        uptime = get_uptime_seconds()
        yolo_info = read_yolo_state()
        serial_info = esp32_reader.get_readings()

        ack_completed = {
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
                    'camera': yolo_info.get('cameraStatus'),
                    'esp32': serial_info.get('status')
                },
                'timestamp': datetime.now(timezone.utc).isoformat()
            },
            'executedAt': datetime.now(timezone.utc).isoformat()
        }
        if sio:
            sio.emit('device:command:ack', ack_completed)
        logger.info("<<< Hoàn tất lệnh PING và gửi ACK COMPLETED")

    else:
        # Từ chối tất cả các lệnh khác (bao gồm TRIGGER_ULTRASONIC và Servo) để bảo đảm an toàn phần cứng
        ack_rejected = {
            'commandId': command_id,
            'deviceId': DEVICE_ID,
            'action': action,
            'status': 'FAILED',
            'message': f"Lệnh '{action}' không được phép thực thi trong giai đoạn này (Chỉ duy trì PING; không thực hiện thao tác điều khiển phần cứng).",
            'error': 'ACTION_NOT_PERMITTED',
            'executedAt': datetime.now(timezone.utc).isoformat()
        }
        if sio:
            sio.emit('device:command:ack', ack_rejected)
        logger.warning("<<< Lệnh '%s' bị từ chối do chính sách an toàn phần cứng.", action)


def build_telemetry_payload() -> dict:
    """Tập hợp gói tin Telemetry đầy đủ từ tất cả các subsystem."""
    uptime = get_uptime_seconds()
    cpu_temp = get_cpu_temp_c()
    local_ip = get_local_ip()
    sent_at = datetime.now(timezone.utc).isoformat()

    # 1. Thu thập dữ liệu từ YOLO AI qua cầu nối IPC (smartbin_yolo_bridge)
    # yolo_camera.py đang chạy trong ~/yolo-env-new trên Pi 5 sẽ xuất kết quả ra file này
    yolo_info = read_yolo_state()

    # Thu thập dữ liệu từ ESP32 Serial
    serial_info = esp32_reader.get_readings()
    comps = serial_info.get('compartments', {})

    # Tính toán distanceCm / fillLevel chung để tương thích ngược với API cũ
    primary_dist = None
    primary_fill = None
    for k in ['recyclable', 'organic', 'nonRecyclable']:
        if comps.get(k, {}).get('distanceCm') is not None:
            primary_dist = comps[k]['distanceCm']
            primary_fill = comps[k]['fillLevel']
            break

    sensors_payload = {
        'distanceCm': primary_dist,
        'fillLevel': primary_fill,
        'organic': comps.get('organic'),
        'recyclable': comps.get('recyclable'),
        'nonRecyclable': comps.get('nonRecyclable')
    }

    subsystems_payload = {
        'yolo': yolo_info.get('yoloStatus', 'STOPPED'),
        'camera': yolo_info.get('cameraStatus', 'DISCONNECTED'),
        'esp32': serial_info.get('status', 'DISCONNECTED')
    }

    ai_detection_payload = yolo_info.get('latestDetection')

    return {
        'deviceId': DEVICE_ID,
        'deviceName': DEVICE_NAME,
        'deviceType': 'RASPBERRY_PI',
        'status': 'ONLINE',
        'uptimeSeconds': uptime,
        'cpuTempC': cpu_temp,
        'firmwareVersion': FIRMWARE_VERSION,
        'ipAddress': local_ip,
        'sentAt': sent_at,
        'subsystems': subsystems_payload,
        'aiDetection': ai_detection_payload,
        'sensors': sensors_payload,
        'metadata': {
            'platform': 'Raspberry Pi 5 (Debian 13 ARM64)',
            'detectionCount': yolo_info.get('detectionCount', 0),
            'lastInferenceMs': yolo_info.get('lastInferenceTimeMs')
        }
    }


def send_telemetry():
    """Gửi gói tin Telemetry lên Backend qua Socket.IO hoặc HTTP fallback."""
    payload = build_telemetry_payload()

    # 1. Ưu tiên gửi qua Socket.IO
    if sio and sio.connected:
        try:
            sio.emit('device:telemetry', payload)
            logger.info(
                "Socket.IO telemetry -> uptime: %ss | temp: %s°C | Subsystems: [YOLO: %s, Cam: %s, ESP32: %s]",
                payload['uptimeSeconds'],
                payload['cpuTempC'],
                payload['subsystems']['yolo'],
                payload['subsystems']['camera'],
                payload['subsystems']['esp32']
            )
            return True
        except Exception as e:
            logger.error("Lỗi khi emit device:telemetry: %s", e)

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
                logger.warning("Fallback HTTP Heartbeat trả về mã lỗi %s: %s", resp.status_code, resp.text)
        except Exception as e:
            logger.warning("Fallback HTTP Heartbeat thất bại: %s", e)

    return False


def handle_exit(signum, frame):
    """Dừng tiến trình và các driver an toàn."""
    global running
    logger.info("Đang dừng Pi Agent và các hệ thống con...")
    running = False

    # Dừng driver phần cứng
    try:
        esp32_reader.stop()
    except Exception:
        pass

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

    # 1. Khởi động ESP32 Serial Reader
    logger.info("Khởi động ESP32 Serial Reader...")
    esp32_reader.start()

    # 2. Giám sát YOLO AI qua cầu nối IPC (smartbin_yolo_bridge)
    # Giữ nguyên chương trình yolo_camera.py chạy độc lập trong virtualenv ~/yolo-env-new
    state_file = os.getenv('SMARTBIN_YOLO_STATE_FILE', '/tmp/smartbin_yolo_state.json')
    logger.info("Chế độ Bridge: Đọc kết quả nhận diện từ yolo_camera.py qua %s...", state_file)

    # 3. Kết nối Socket.IO
    logger.info("Đang khởi tạo kết nối Socket.IO...")
    try:
        sio.connect(
            SERVER_URL,
            auth={
                'type': 'device',
                'token': DEVICE_INGEST_TOKEN,
                'deviceId': DEVICE_ID
            },
            transports=['websocket', 'polling']
        )
    except Exception as e:
        logger.warning("Chưa thể kết nối Socket.IO ngay lập tức (%s). Đang chạy chế độ tự kết nối lại trong nền...", e)

    # 4. Vòng lặp gửi Telemetry định kỳ
    while running:
        send_telemetry()
        time.sleep(TELEMETRY_INTERVAL)


if __name__ == '__main__':
    main()
