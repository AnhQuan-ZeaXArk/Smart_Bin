#!/usr/bin/env python3
"""
SmartBin Raspberry Pi 5 Agent (Debian 13 ARM64)
Giao tiếp thời gian thực hai chiều giữa Raspberry Pi 5 và SmartBin Backend qua Socket.IO.

Chức năng:
1. Xác thực an toàn với Backend qua Socket.IO Handshake Auth (Bearer token qua DEVICE_INGEST_TOKEN).
2. Tự động gia nhập Room 'device' và 'device:raspberry-pi-5'.
3. Thu thập và gửi Telemetry phần cứng định kỳ (5–10s): Uptime, Nhiệt độ CPU, Trạng thái.
4. Lắng nghe và thực thi các lệnh an toàn từ Web qua Socket.IO: PING, TRIGGER_ULTRASONIC.
5. Phản hồi trạng thái thực thi (ACK) ngay lập tức về Backend.
6. Tự động kết nối lại (Auto-reconnect) khi mất mạng; hỗ trợ HTTP fallback khi Socket chưa kết nối.
"""

import os
import sys
import time
import signal
import logging
from datetime import datetime, timezone
from pathlib import Path

# Nạp biến môi trường từ .env nếu có
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent / '.env'
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
    else:
        load_dotenv()
except ImportError:
    pass

import requests
import socketio

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
DEVICE_INGEST_TOKEN = os.getenv('DEVICE_INGEST_TOKEN', '').strip()
TELEMETRY_INTERVAL = max(5, min(60, int(os.getenv('TELEMETRY_INTERVAL', '5'))))

# Biến cờ điều khiển vòng lặp chính
running = True
start_time = time.time()

# Khởi tạo Socket.IO Client với cấu hình tự động Reconnect
sio = socketio.Client(
    reconnection=True,
    reconnection_attempts=0,     # 0 = thử kết nối lại vô hạn
    reconnection_delay=2,        # Thử lại sau 2 giây
    reconnection_delay_max=10,   # Tối đa 10 giây
    logger=False,
    engineio_logger=False
)


def get_uptime_seconds() -> int:
    """Lấy thời gian hoạt động hệ thống từ /proc/uptime (Debian Linux)."""
    try:
        with open('/proc/uptime', 'r', encoding='utf-8') as f:
            uptime_str = f.readline().split()[0]
            return int(float(uptime_str))
    except Exception:
        # Fallback tính theo thời gian chạy của script nếu không đọc được /proc
        return int(time.time() - start_time)


def get_cpu_temp_c() -> float | None:
    """Lấy nhiệt độ CPU thực tế từ thermal_zone0 trên Raspberry Pi 5."""
    thermal_file = '/sys/class/thermal/thermal_zone0/temp'
    try:
        if os.path.exists(thermal_file):
            with open(thermal_file, 'r', encoding='utf-8') as f:
                raw_val = f.read().strip()
                temp = round(float(raw_val) / 1000.0, 1)
                return temp
    except Exception as e:
        logger.debug("Không thể đọc /sys/class/thermal/thermal_zone0/temp: %s", e)
    return None


def read_ultrasonic_sensor() -> dict | None:
    """
    Đọc dữ liệu từ cảm biến siêu âm vật lý nếu đã gắn vào GPIO Pi 5.
    Lưu ý: Không tự bịa số liệu. Nếu chưa gắn phần cứng, trả về None.
    """
    # Kiểm tra biến môi trường cấu hình chân GPIO (ví dụ: TRIG_PIN, ECHO_PIN)
    trig_pin = os.getenv('ULTRASONIC_TRIG_PIN')
    echo_pin = os.getenv('ULTRASONIC_ECHO_PIN')

    if not trig_pin or not echo_pin:
        # Phần cứng cảm biến chưa được cấu hình chân GPIO trên Pi
        return None

    try:
        # Nếu thư viện gpiod hoặc RPi.GPIO có sẵn trên Debian 13
        # Có thể tích hợp đo thực tế tại đây khi người dùng nối dây
        pass
    except Exception as e:
        logger.warning("Lỗi khi đọc cảm biến siêu âm: %s", e)
    return None


@sio.event
def connect():
    """Sự kiện khi kết nối Socket.IO thành công."""
    logger.info("Đã kết nối thành công tới SmartBin Socket.IO Server: %s", SERVER_URL)
    logger.info("Thiết bị '%s' đã tự động gia nhập room 'device' và 'device:%s'", DEVICE_ID, DEVICE_ID)


@sio.event
def connect_error(data):
    """Sự kiện lỗi kết nối."""
    logger.warning("Kết nối Socket.IO thất bại: %s. Sẽ tự động thử lại...", data)


@sio.event
def disconnect():
    """Sự kiện mất kết nối Socket.IO."""
    logger.warning("Đã ngắt kết nối khỏi Socket.IO Server. Đang tự động kết nối lại...")


@sio.on('realtime:connected')
def on_realtime_connected(data):
    """Server xác nhận hoàn tất bắt tay (handshake)."""
    logger.info("Xác nhận phiên kết nối realtime: %s", data)


@sio.on('device:command')
def on_device_command(payload):
    """
    Lắng nghe lệnh điều khiển từ SmartBin Web được Backend phân phối tới.
    Chỉ thực thi các lệnh an toàn: PING và TRIGGER_ULTRASONIC.
    """
    if not isinstance(payload, dict):
        logger.warning("Nhận lệnh không đúng định dạng: %s", payload)
        return

    command_id = payload.get('commandId', '')
    action = payload.get('action', '')
    params = payload.get('params', {}) or {}

    logger.info(">>> Nhận lệnh từ Web: action='%s' (commandId=%s)", action, command_id)

    # 1. Gửi phản hồi ACK trạng thái RECEIVED ngay lập tức
    ack_received = {
        'commandId': command_id,
        'deviceId': DEVICE_ID,
        'action': action,
        'status': 'RECEIVED',
        'message': f"Raspberry Pi 5 đã nhận lệnh {action}"
    }
    sio.emit('device:command:ack', ack_received)

    # 2. Xử lý lệnh theo từng loại
    if action == 'PING':
        # Thực hiện lệnh PING: Thu thập trạng thái tức thời
        cpu_temp = get_cpu_temp_c()
        uptime = get_uptime_seconds()
        
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
                'timestamp': datetime.now(timezone.utc).isoformat()
            },
            'executedAt': datetime.now(timezone.utc).isoformat()
        }
        sio.emit('device:command:ack', ack_completed)
        logger.info("<<< Hoàn tất lệnh PING và gửi ACK COMPLETED (temp: %s°C, uptime: %ss)", cpu_temp, uptime)

    elif action == 'TRIGGER_ULTRASONIC':
        # Thực hiện đo cảm biến siêu âm
        sensor_data = read_ultrasonic_sensor()
        if sensor_data is not None:
            ack_completed = {
                'commandId': command_id,
                'deviceId': DEVICE_ID,
                'action': 'TRIGGER_ULTRASONIC',
                'status': 'COMPLETED',
                'message': 'Đo cảm biến siêu âm thành công.',
                'result': sensor_data,
                'executedAt': datetime.now(timezone.utc).isoformat()
            }
            sio.emit('device:command:ack', ack_completed)
            logger.info("<<< Hoàn tất TRIGGER_ULTRASONIC và gửi ACK COMPLETED")
        else:
            # Phần cứng cảm biến chưa được nối dây thực tế
            ack_failed = {
                'commandId': command_id,
                'deviceId': DEVICE_ID,
                'action': 'TRIGGER_ULTRASONIC',
                'status': 'FAILED',
                'message': 'Cảm biến siêu âm chưa kết nối chân GPIO vật lý trên Pi 5.',
                'error': 'SENSOR_NOT_ATTACHED',
                'executedAt': datetime.now(timezone.utc).isoformat()
            }
            sio.emit('device:command:ack', ack_failed)
            logger.warning("<<< Cảm biến siêu âm chưa gắn phần cứng. Gửi ACK FAILED.")

    else:
        # Từ chối các lệnh chưa được phép (SYSTEM_REBOOT, OPEN_LID, v.v.)
        ack_rejected = {
            'commandId': command_id,
            'deviceId': DEVICE_ID,
            'action': action,
            'status': 'FAILED',
            'message': f"Lệnh '{action}' không được phép thực thi trong giai đoạn này.",
            'error': 'ACTION_NOT_PERMITTED',
            'executedAt': datetime.now(timezone.utc).isoformat()
        }
        sio.emit('device:command:ack', ack_rejected)
        logger.warning("<<< Lệnh '%s' bị từ chối do chính sách bảo mật.", action)


def send_telemetry():
    """Thu thập và gửi gói tin Telemetry lên Backend."""
    uptime = get_uptime_seconds()
    cpu_temp = get_cpu_temp_c()
    sent_at = datetime.now(timezone.utc).isoformat()

    telemetry_payload = {
        'deviceId': DEVICE_ID,
        'status': 'ONLINE',
        'uptimeSeconds': uptime,
        'cpuTempC': cpu_temp,
        'sentAt': sent_at,
        'sensors': None  # Sẽ bổ sung khi có cảm biến thực tế
    }

    # Ưu tiên gửi qua Socket.IO hai chiều
    if sio.connected:
        try:
            sio.emit('device:telemetry', telemetry_payload)
            logger.info("Gửi Socket.IO telemetry -> uptime: %ss | temp: %s°C", uptime, cpu_temp)
            return True
        except Exception as e:
            logger.error("Lỗi khi emit device:telemetry: %s", e)

    # Fallback qua HTTP POST nếu Socket.IO chưa kết nối
    if DEVICE_INGEST_TOKEN:
        try:
            url = f"{SERVER_URL}/api/demo/device-heartbeat"
            headers = {
                'Authorization': f'Bearer {DEVICE_INGEST_TOKEN}',
                'Content-Type': 'application/json'
            }
            resp = requests.post(url, json=telemetry_payload, headers=headers, timeout=5)
            if resp.status_code == 200:
                logger.info("Gửi Fallback HTTP Heartbeat thành công -> uptime: %ss | temp: %s°C", uptime, cpu_temp)
                return True
            else:
                logger.warning("Fallback HTTP Heartbeat trả về mã lỗi %s: %s", resp.status_code, resp.text)
        except Exception as e:
            logger.warning("Fallback HTTP Heartbeat thất bại: %s", e)

    return False


def handle_exit(signum, frame):
    """Xử lý tín hiệu dừng chương trình (Ctrl+C hoặc kill)."""
    global running
    logger.info("Đang dừng Pi Agent an toàn...")
    running = False
    if sio.connected:
        try:
            sio.disconnect()
        except Exception:
            pass
    sys.exit(0)


def main():
    """Hàm khởi động chính của Pi Agent."""
    global running
    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    logger.info("==================================================")
    logger.info("   SmartBin Raspberry Pi 5 Agent v1.0.0          ")
    logger.info("   Nền tảng: Debian 13 ARM64                     ")
    logger.info("   Device ID: %s", DEVICE_ID)
    logger.info("   Server URL: %s", SERVER_URL)
    logger.info("   Chu kỳ Telemetry: %s giây                     ", TELEMETRY_INTERVAL)
    logger.info("==================================================")

    if not DEVICE_INGEST_TOKEN:
        logger.error("LỖI: Chưa cấu hình DEVICE_INGEST_TOKEN trong biến môi trường hoặc file .env!")
        logger.error("Vui lòng thiết lập DEVICE_INGEST_TOKEN=<token> trước khi chạy.")
        sys.exit(1)

    # Kết nối Socket.IO tới Backend
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

    # Vòng lặp gửi Telemetry định kỳ
    while running:
        send_telemetry()
        time.sleep(TELEMETRY_INTERVAL)


if __name__ == '__main__':
    main()
