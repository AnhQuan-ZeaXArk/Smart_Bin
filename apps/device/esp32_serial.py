#!/usr/bin/env python3
"""
SmartBin ESP32 USB Serial Driver (Baud rate 115200)
Giao tiếp USB Serial với vi điều khiển ESP32 đọc cảm biến siêu âm 3 ngăn:
- ORGANIC (Rác hữu cơ)
- RECYCLABLE (Rác tái chế)
- NON_RECYCLABLE (Rác không tái chế)

Đặc điểm an toàn:
1. Chạy trong background thread riêng biệt, không block Socket.IO hoặc YOLO.
2. Tự động tìm kiếm cổng (/dev/serial/by-id/, /dev/ttyUSB0, /dev/ttyACM0, COMx) và tự reconnect khi rút/cắm cáp USB.
3. Đọc từng dòng JSON kết thúc bằng '\\n'.
4. Tính phần trăm đầy theo 2 mốc hiệu chuẩn rác: EMPTY_DISTANCE_CM và FULL_DISTANCE_CM.
5. Kiểm tra dữ liệu ngoài phạm vi (HC-SR04: 2cm - 400cm) và đánh dấu STALE nếu quá 15s không có dữ liệu.
6. TUYỆT ĐỐI KHÔNG gửi lệnh điều khiển Servo tự phát (chỉ đọc cảm biến).
"""

import os
import sys
import time
import json
import glob
import logging
import threading
from datetime import datetime, timezone
from typing import Dict, Any, Optional

logger = logging.getLogger('SmartBin-ESP32')

# Cấu hình ngưỡng hiệu chuẩn thùng rác (cm)
DEFAULT_EMPTY_DISTANCE_CM = float(os.getenv('EMPTY_DISTANCE_CM', '50.0'))  # Khi thùng trống hoàn toàn
DEFAULT_FULL_DISTANCE_CM = float(os.getenv('FULL_DISTANCE_CM', '5.0'))     # Khi rác đầy tới miệng
SENSOR_STALE_TIMEOUT_SEC = float(os.getenv('SENSOR_STALE_TIMEOUT_SEC', '15.0'))
SERIAL_BAUD_RATE = int(os.getenv('ESP32_BAUD_RATE', '115200'))


def calculate_fill_percentage(
    distance_cm: float,
    empty_cm: float = DEFAULT_EMPTY_DISTANCE_CM,
    full_cm: float = DEFAULT_FULL_DISTANCE_CM
) -> tuple[Optional[int], str]:
    """
    Tính phần trăm mức đầy dựa trên khoảng cách đo được từ cảm biến siêu âm.
    Trả về (fill_percentage, status_str).
    """
    # Cảm biến siêu âm HC-SR04 chỉ có dải đo vật lý từ 2cm đến 400cm
    if distance_cm < 1.0 or distance_cm > 400.0:
        return None, 'OUT_OF_RANGE'

    # Khoảng cách nhỏ hơn hoặc bằng mốc đầy -> 100%
    if distance_cm <= full_cm:
        return 100, 'OK'

    # Khoảng cách lớn hơn hoặc bằng mốc rỗng -> 0%
    if distance_cm >= empty_cm:
        return 0, 'OK'

    # Tính toán tuyến tính kẹp trong [0, 100]
    height_span = empty_cm - full_cm
    if height_span <= 0:
        return 0, 'CALIBRATION_ERROR'

    fill = round(((empty_cm - distance_cm) / height_span) * 100)
    fill = max(0, min(100, fill))
    return fill, 'OK'


class ESP32SerialReader:
    """Lớp quản lý kết nối USB Serial với ESP32 chạy trong Background Thread."""

    def __init__(self, port: Optional[str] = None, baud_rate: int = SERIAL_BAUD_RATE):
        self.preferred_port = port or os.getenv('ESP32_PORT')
        self.baud_rate = baud_rate
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

        # Trạng thái cảm biến 3 ngăn được bảo vệ bởi Mutex
        self.status = 'DISCONNECTED'  # CONNECTED | DISCONNECTED | ERROR
        self.active_port: Optional[str] = None
        self.last_packet_time: Optional[float] = None
        self.last_error: Optional[str] = None

        self.compartments: Dict[str, Dict[str, Any]] = {
            'organic': {
                'distanceCm': None,
                'fillLevel': None,
                'status': 'NOT_ATTACHED',
                'updatedAt': None
            },
            'recyclable': {
                'distanceCm': None,
                'fillLevel': None,
                'status': 'NOT_ATTACHED',
                'updatedAt': None
            },
            'nonRecyclable': {
                'distanceCm': None,
                'fillLevel': None,
                'status': 'NOT_ATTACHED',
                'updatedAt': None
            }
        }

    def find_serial_port(self) -> Optional[str]:
        """Tự động tìm kiếm cổng Serial thực tế của ESP32."""
        if self.preferred_port and os.path.exists(self.preferred_port):
            return self.preferred_port

        # 1. Tìm trong /dev/serial/by-id/ (ổn định nhất trên Linux)
        by_id_ports = glob.glob('/dev/serial/by-id/*')
        if by_id_ports:
            for p in by_id_ports:
                if 'usb' in p.lower() or 'cp210' in p.lower() or 'ch340' in p.lower() or 'esp' in p.lower():
                    return p
            return by_id_ports[0]

        # 2. Tìm cổng ttyUSB* hoặc ttyACM*
        usb_ports = glob.glob('/dev/ttyUSB*') + glob.glob('/dev/ttyACM*')
        if usb_ports:
            return sorted(usb_ports)[0]

        # 3. Trên Windows (khi phát triển / test)
        if sys.platform.startswith('win'):
            try:
                import serial.tools.list_ports
                ports = serial.tools.list_ports.comports()
                for p in ports:
                    if 'CP210' in p.description or 'CH340' in p.description or 'USB' in p.description or 'UART' in p.description:
                        return p.device
                if ports:
                    return ports[0].device
            except ImportError:
                pass

        return None

    def start(self):
        """Khởi động luồng đọc Serial."""
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._worker_loop, daemon=True, name='ESP32-Serial-Worker')
        self.thread.start()
        logger.info("Đã khởi động ESP32 Serial Reader thread.")

    def stop(self):
        """Dừng luồng đọc Serial an toàn."""
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)
        with self._lock:
            self.status = 'DISCONNECTED'
        logger.info("Đã dừng ESP32 Serial Reader thread.")

    def _worker_loop(self):
        """Vòng lặp đọc dữ liệu Serial liên tục kèm tự động kết nối lại (Auto-reconnect)."""
        serial_module = None
        try:
            import serial
            serial_module = serial
        except ImportError:
            logger.warning("Thư viện 'pyserial' chưa được cài đặt. Không thể mở cổng Serial vật lý.")
            with self._lock:
                self.status = 'ERROR'
                self.last_error = 'PYSERIAL_NOT_INSTALLED'
            return

        while self.running:
            port = self.find_serial_port()
            if not port:
                with self._lock:
                    self.status = 'DISCONNECTED'
                    self.active_port = None
                    self._check_stale_under_lock()
                time.sleep(2.0)
                continue

            ser = None
            try:
                ser = serial_module.Serial(
                    port=port,
                    baudrate=self.baud_rate,
                    timeout=1.0,
                    write_timeout=1.0
                )
                logger.info("Đã kết nối thành công tới ESP32 trên cổng: %s (baud: %s)", port, self.baud_rate)
                with self._lock:
                    self.status = 'CONNECTED'
                    self.active_port = port
                    self.last_error = None

                # Đọc dòng liên tục
                while self.running:
                    raw_line = ser.readline()
                    if not raw_line:
                        # Timeout đọc 1s không có dòng mới -> Kiểm tra stale
                        with self._lock:
                            self._check_stale_under_lock()
                        continue

                    try:
                        line = raw_line.decode('utf-8', errors='replace').strip()
                        if not line or not line.startswith('{') or not line.endswith('}'):
                            continue

                        data = json.loads(line)
                        self._process_serial_data(data)
                    except json.JSONDecodeError:
                        logger.debug("Bỏ qua gói Serial không phải JSON hợp lệ: %s", raw_line)
                    except Exception as e:
                        logger.warning("Lỗi xử lý gói Serial: %s", e)

            except (serial_module.SerialException, OSError) as e:
                logger.warning("Mất kết nối hoặc không mở được cổng ESP32 %s: %s. Đang thử lại...", port, e)
                with self._lock:
                    self.status = 'DISCONNECTED'
                    self.active_port = None
                    self.last_error = str(e)
                    self._check_stale_under_lock()
            finally:
                if ser:
                    try:
                        ser.close()
                    except Exception:
                        pass

            time.sleep(2.0)

    def _process_serial_data(self, data: Dict[str, Any]):
        """Xử lý dữ liệu JSON nhận được từ ESP32."""
        now_ts = datetime.now(timezone.utc).isoformat()
        now_epoch = time.time()

        # Hỗ trợ 2 định dạng:
        # Định dạng 1: {"compartments": {"organic": {"distanceCm": 30.5}, ...}}
        # Định dạng 2: {"organic_cm": 30.5, "recyclable_cm": 15.0, "non_recyclable_cm": 8.0}
        with self._lock:
            self.last_packet_time = now_epoch
            self.status = 'CONNECTED'

            compartments_map = {
                'organic': None,
                'recyclable': None,
                'nonRecyclable': None
            }

            if 'compartments' in data and isinstance(data['compartments'], dict):
                comp_data = data['compartments']
                for key in ['organic', 'recyclable', 'nonRecyclable', 'non_recyclable']:
                    canonical_key = 'nonRecyclable' if key == 'non_recyclable' else key
                    if key in comp_data and isinstance(comp_data[key], dict):
                        dist = comp_data[key].get('distanceCm') or comp_data[key].get('distance')
                        if dist is not None:
                            try:
                                compartments_map[canonical_key] = float(dist)
                            except (ValueError, TypeError):
                                pass

            # Fallback đọc flat keys
            if compartments_map['organic'] is None and 'organic_cm' in data:
                compartments_map['organic'] = float(data['organic_cm'])
            if compartments_map['recyclable'] is None and 'recyclable_cm' in data:
                compartments_map['recyclable'] = float(data['recyclable_cm'])
            if compartments_map['nonRecyclable'] is None:
                if 'non_recyclable_cm' in data:
                    compartments_map['nonRecyclable'] = float(data['non_recyclable_cm'])
                elif 'nonRecyclable_cm' in data:
                    compartments_map['nonRecyclable'] = float(data['nonRecyclable_cm'])

            # Cập nhật từng ngăn
            for comp_key, dist_val in compartments_map.items():
                if dist_val is not None:
                    fill_pct, comp_status = calculate_fill_percentage(dist_val)
                    self.compartments[comp_key] = {
                        'distanceCm': round(dist_val, 1) if comp_status == 'OK' else None,
                        'fillLevel': fill_pct,
                        'status': comp_status,
                        'updatedAt': now_ts
                    }

    def _check_stale_under_lock(self):
        """Kiểm tra và đánh dấu STALE nếu quá hạn thời gian nhận gói tin."""
        if not self.last_packet_time:
            return
        if time.time() - self.last_packet_time > SENSOR_STALE_TIMEOUT_SEC:
            for comp_key in self.compartments:
                if self.compartments[comp_key]['status'] == 'OK':
                    self.compartments[comp_key]['status'] = 'STALE'

    def inject_mock_data(self, organic_cm: float, recyclable_cm: float, non_recyclable_cm: float):
        """Hàm phục vụ Unit / Integration Test và mô phỏng."""
        self._process_serial_data({
            'organic_cm': organic_cm,
            'recyclable_cm': recyclable_cm,
            'non_recyclable_cm': non_recyclable_cm
        })

    def get_readings(self) -> Dict[str, Any]:
        """Lấy bản sao an toàn (thread-safe snapshot) dữ liệu cảm biến hiện tại."""
        with self._lock:
            self._check_stale_under_lock()
            return {
                'status': self.status,
                'activePort': self.active_port,
                'lastPacketTime': self.last_packet_time,
                'compartments': {
                    'organic': dict(self.compartments['organic']),
                    'recyclable': dict(self.compartments['recyclable']),
                    'nonRecyclable': dict(self.compartments['nonRecyclable'])
                }
            }

