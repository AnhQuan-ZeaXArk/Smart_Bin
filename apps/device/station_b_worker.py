#!/usr/bin/env python3
"""
SmartBin Station B Serial Worker (ESP32-C6 / Baud rate 115200)
Đặc tả kết nối và đọc cảm biến độc lập cho Trạm B:
- Kết nối qua cổng cố định /dev/smartbin_station_b (hoặc STATION_B_SERIAL_PORT / by-path).
- Phân tích cú pháp NDJSON kèm kiểm tra Checksum CRC16-CCITT.
- Cấu hình Trạm B: Chỉ có ngăn RECYCLABLE được gắn cảm biến; NON_RECYCLABLE và ORGANIC là NOT_INSTALLED.
- TUYỆT ĐỐI KHÔNG can thiệp hoặc mở cổng Serial A (/dev/ttyUSB0).
"""

import os
import sys
import time
import json
import glob
import logging
import threading
from typing import Dict, Any, Optional

logger = logging.getLogger('SmartBin-StationB-Worker')

SERIAL_B_BAUD_RATE = int(os.getenv('STATION_B_BAUD_RATE', '115200'))


def calculate_crc16_ccitt(data: bytes) -> int:
    """Tính toán mã kiểm tra CRC-16/CCITT-FALSE (Polynomial 0x1021, Init 0xFFFF)."""
    crc = 0xFFFF
    for byte in data:
        crc ^= (byte << 8)
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


class StationBSerialWorker:
    """Quản lý kết nối và tiếp nhận dữ liệu từ vi điều khiển ESP32-C6 Trạm B."""

    def __init__(self, port: Optional[str] = None, baud_rate: int = SERIAL_B_BAUD_RATE):
        self.preferred_port = port or os.getenv('STATION_B_SERIAL_PORT')
        self.baud_rate = baud_rate
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

        self.status = 'DISCONNECTED'
        self.active_port: Optional[str] = None
        self.last_packet_time: Optional[float] = None
        self.last_error: Optional[str] = None

        # Trạng thái cảm biến Trạm B (Chỉ Recyclable được lắp đặt)
        self.latest_telemetry: Optional[Dict[str, Any]] = None

    def find_serial_port(self) -> Optional[str]:
        """Xác định cổng Serial B theo thứ tự phân cấp 3 tầng."""
        # 1. Cấu hình rõ ràng qua biến môi trường hoặc tham số
        if self.preferred_port and os.path.exists(self.preferred_port):
            return self.preferred_port

        # 2. Symlink cố định từ udev rule
        if os.path.exists('/dev/smartbin_station_b'):
            return '/dev/smartbin_station_b'

        # 3. Tìm theo physical path USB trên Linux
        by_path_ports = glob.glob('/dev/serial/by-path/*')
        if by_path_ports:
            # Chọn cổng USB vật lý khác với Serial A (/dev/ttyUSB0)
            for p in by_path_ports:
                if 'ttyUSB0' not in os.path.realpath(p):
                    return p

        # 4. Tìm trong /dev/serial/by-id/
        by_id_ports = glob.glob('/dev/serial/by-id/*')
        if by_id_ports:
            for p in by_id_ports:
                if 'usb' in p.lower() or 'cp210' in p.lower() or 'ch340' in p.lower() or 'esp' in p.lower():
                    # Tránh chọn trùng cổng ttyUSB0 của Trạm A
                    real = os.path.realpath(p)
                    if not real.endswith('ttyUSB0'):
                        return p

        # 4b. Cổng ttyUSB1 trực tiếp (nếu khác ttyUSB0 của Trạm A)
        if os.path.exists('/dev/ttyUSB1'):
            real_b = os.path.realpath('/dev/ttyUSB1')
            if not real_b.endswith('ttyUSB0'):
                return '/dev/ttyUSB1'

        # 5. Hỗ trợ Windows khi phát triển / test
        if sys.platform.startswith('win'):
            try:
                import serial.tools.list_ports
                ports = serial.tools.list_ports.comports()
                if len(ports) > 1:
                    return ports[1].device
                elif len(ports) == 1:
                    return ports[0].device
            except ImportError:
                pass

        return None

    def start(self):
        """Khởi động luồng đọc Serial B độc lập."""
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._worker_loop, daemon=True, name='StationB-SerialWorker')
        self.thread.start()
        logger.info("Đã khởi động Station B Serial Worker thread.")

    def stop(self):
        """Dừng luồng đọc an toàn."""
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)
        with self._lock:
            self.status = 'DISCONNECTED'
        logger.info("Đã dừng Station B Serial Worker thread.")

    def get_latest_data(self, max_age_seconds: float = 10.0) -> Optional[Dict[str, Any]]:
        """Lấy gói tin telemetry mới nhất của Trạm B (Thread-safe).
        Chỉ trả về dữ liệu nếu worker đang CONNECTED và dữ liệu còn mới (<= max_age_seconds).
        Không dùng dữ liệu cũ để giả lập dữ liệu mới khi mất kết nối hoặc quá hạn.
        """
        with self._lock:
            if not self.latest_telemetry or self.status != 'CONNECTED':
                return None
            if self.last_packet_time and (time.time() - self.last_packet_time > max_age_seconds):
                return None
            return dict(self.latest_telemetry)

    def is_connected(self) -> bool:
        with self._lock:
            return self.status == 'CONNECTED'

    def _worker_loop(self):
        """Vòng lặp đọc Serial liên tục với cơ chế tự động thử lại (Backoff 1s - 10s)."""
        serial_module = None
        try:
            import serial
            serial_module = serial
        except ImportError:
            logger.warning("Thư viện 'pyserial' chưa được cài đặt. Không thể mở Serial B vật lý.")
            with self._lock:
                self.status = 'ERROR'
                self.last_error = 'PYSERIAL_NOT_INSTALLED'
            return

        backoff_sec = 1.0

        while self.running:
            port = self.find_serial_port()
            if not port:
                with self._lock:
                    self.status = 'DISCONNECTED'
                    self.active_port = None
                time.sleep(min(backoff_sec, 10.0))
                backoff_sec = min(backoff_sec * 2.0, 10.0)
                continue

            ser = None
            try:
                ser = serial_module.Serial(
                    port=port,
                    baudrate=self.baud_rate,
                    timeout=1.0,
                    write_timeout=1.0
                )
                logger.info("Đã kết nối thành công tới ESP32-C6 Trạm B trên cổng: %s", port)
                with self._lock:
                    self.status = 'CONNECTED'
                    self.active_port = port
                    self.last_error = None
                backoff_sec = 1.0

                while self.running:
                    raw_line = ser.readline()
                    if not raw_line:
                        continue

                    try:
                        line = raw_line.decode('utf-8', errors='replace').strip()
                        if not line or not line.startswith('{') or not line.endswith('}'):
                            continue

                        data = json.loads(line)
                        self._process_packet(data)
                    except json.JSONDecodeError:
                        logger.debug("Bỏ qua gói Serial B không phải JSON hợp lệ: %s", raw_line)
                    except Exception as e:
                        logger.warning("Lỗi xử lý gói tin Serial B: %s", e)

            except (serial_module.SerialException, OSError) as e:
                logger.warning("Mất kết nối cổng Serial B %s: %s. Đang tự động kết nối lại...", port, e)
                with self._lock:
                    self.status = 'DISCONNECTED'
                    self.active_port = None
                    self.last_error = str(e)
            finally:
                if ser:
                    try:
                        ser.close()
                    except Exception:
                        pass

            time.sleep(min(backoff_sec, 10.0))
            backoff_sec = min(backoff_sec * 2.0, 10.0)

    def _process_packet(self, data: Dict[str, Any]):
        """Xác minh Checksum CRC16 và lưu trữ dữ liệu Trạm B."""
        # Kiểm tra cấu trúc cơ bản
        if 'stationCode' not in data or data.get('stationCode') != 'STATION_B':
            return

        # Xác thực CRC16 nếu có
        if 'crc16' in data:
            received_crc = data['crc16']
            data_copy = dict(data)
            del data_copy['crc16']
            # Chuẩn hóa JSON string để tính CRC (hỗ trợ cả chuẩn canonical sorted và thứ tự firmware)
            canonical_bytes = json.dumps(data_copy, separators=(',', ':'), sort_keys=True).encode('utf-8')
            expected_crc = calculate_crc16_ccitt(canonical_bytes)
            if received_crc != expected_crc:
                unsorted_bytes = json.dumps(data_copy, separators=(',', ':')).encode('utf-8')
                expected_unsorted = calculate_crc16_ccitt(unsorted_bytes)
                if received_crc != expected_unsorted:
                    logger.warning("CRC16 checksum mismatch on Serial B! Received: %s, Expected: %s (or %s)", received_crc, expected_crc, expected_unsorted)
                    return

        now_epoch = time.time()
        with self._lock:
            self.last_packet_time = now_epoch
            self.status = 'CONNECTED'
            self.latest_telemetry = data

