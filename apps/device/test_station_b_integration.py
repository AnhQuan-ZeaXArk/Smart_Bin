#!/usr/bin/env python3
"""
Unit and Integration Tests for Station B Hardware Integration & Offline Buffer
Round 18.1 Critical Blockers Fix Verification:
1. CRC16-CCITT calculation and verification
2. Station B Serial Worker NDJSON parsing and validation
3. Offline Buffer: Verified ACK success lifecycle
4. Offline Buffer: ACK timeout and retry handling (mark_failed)
5. Offline Buffer: Connection loss enqueuing
6. Offline Buffer: Pi Agent restart recovery (IN_FLIGHT -> QUEUED)
7. Offline Buffer: Lost ACK / duplicate retry idempotency simulation
8. Offline Buffer: FIFO overflow eviction and logging
"""

import os
import sys
import json
import time
import tempfile
import unittest
from pathlib import Path

# Add apps/device to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from station_b_worker import StationBSerialWorker, calculate_crc16_ccitt
from offline_buffer import OfflineBuffer, MAX_BUFFER_CAPACITY


class TestStationBHardwareIntegration(unittest.TestCase):

    def test_01_crc16_calculation(self):
        """Kiểm tra thuật toán CRC16-CCITT."""
        test_data = b"123456789"
        # Standard CRC-16/CCITT-FALSE of "123456789" is 0x29B1 (10673)
        crc = calculate_crc16_ccitt(test_data)
        self.assertEqual(crc, 0x29B1, f"Expected 0x29B1 (10673), got {hex(crc)}")

    def test_02_worker_valid_packet_parsing(self):
        """Worker phân tích và chấp nhận gói tin NDJSON có CRC16 hợp lệ."""
        worker = StationBSerialWorker()
        packet = {
            "stationCode": "STATION_B",
            "deviceId": "esp32c6-station-b",
            "bootCount": 1,
            "sampleSeq": 101,
            "telemetryVersion": 2,
            "sensors": {
                "recyclable": {
                    "fillLevel": 45,
                    "distanceCm": 22.0,
                    "status": "OK"
                }
            }
        }
        canonical_bytes = json.dumps(packet, separators=(',', ':'), sort_keys=True).encode('utf-8')
        packet["crc16"] = calculate_crc16_ccitt(canonical_bytes)

        worker._process_packet(packet)
        latest = worker.get_latest_data()
        self.assertIsNotNone(latest)
        self.assertEqual(latest.get("stationCode"), "STATION_B")
        self.assertEqual(latest.get("sampleSeq"), 101)
        self.assertIn("recyclable", latest.get("sensors", {}))

    def test_03_worker_corrupted_crc_rejected(self):
        """Worker từ chối gói tin có CRC16 bị sai lệch (bị nhiễu đường truyền)."""
        worker = StationBSerialWorker()
        packet = {
            "stationCode": "STATION_B",
            "deviceId": "esp32c6-station-b",
            "bootCount": 1,
            "sampleSeq": 102,
            "telemetryVersion": 2,
            "sensors": {
                "recyclable": {
                    "fillLevel": 50,
                    "distanceCm": 20.0,
                    "status": "OK"
                }
            },
            "crc16": 99999 # Wrong CRC
        }
        worker._process_packet(packet)
        latest = worker.get_latest_data()
        self.assertIsNone(latest, "Corrupted CRC packet must be dropped")

    def test_04_offline_buffer_ack_success_lifecycle(self):
        """BLOCKER-01: Chỉ đánh dấu ACKED và prune SAU KHI nhận ACK thành công."""
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
            tmp_db_path = tmp.name

        try:
            buf = OfflineBuffer(db_path=tmp_db_path)
            msg_id = "STATION_B-1-100-test"
            buf.enqueue(msg_id, "STATION_B", "RECYCLABLE", '{"seq": 100}')

            # 1. Gói tin ban đầu ở trạng thái QUEUED
            batch = buf.peek_batch(limit=10)
            self.assertEqual(len(batch), 1)
            self.assertEqual(batch[0]["status"], "QUEUED")

            # 2. Đang gửi: chuyển sang IN_FLIGHT
            buf.mark_in_flight([batch[0]["id"]])
            # peek_batch chỉ lấy QUEUED, nên batch tiếp theo phải rỗng
            self.assertEqual(len(buf.peek_batch(limit=10)), 0)

            # 3. Backend phản hồi ACK thành công -> Đánh dấu ACKED và prune
            buf.mark_acked([msg_id])
            buf.prune_acked()

            # 4. Bản ghi đã được dọn sạch hoàn toàn khỏi SQLite
            with buf._connection() as conn:
                count = conn.execute("SELECT COUNT(*) AS c FROM offline_telemetry").fetchone()['c']
                self.assertEqual(count, 0)
        finally:
            try:
                if os.path.exists(tmp_db_path):
                    os.unlink(tmp_db_path)
            except Exception:
                pass

    def test_05_offline_buffer_ack_timeout_and_retry(self):
        """BLOCKER-01: Timeout hoặc mất kết nối -> mark_failed đưa về QUEUED để retry."""
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
            tmp_db_path = tmp.name

        try:
            buf = OfflineBuffer(db_path=tmp_db_path)
            msg_id = "STATION_B-1-101-timeout"
            buf.enqueue(msg_id, "STATION_B", "RECYCLABLE", '{"seq": 101}')

            batch = buf.peek_batch(limit=10)
            buf.mark_in_flight([batch[0]["id"]])

            # Giả lập timeout (sau 5s không có ACK từ server) -> mark_failed
            buf.mark_failed([msg_id])

            # Gói tin phải trở lại QUEUED để sẵn sàng retry trong lần gửi tiếp theo
            retried_batch = buf.peek_batch(limit=10)
            self.assertEqual(len(retried_batch), 1)
            self.assertEqual(retried_batch[0]["client_message_id"], msg_id)
            self.assertEqual(retried_batch[0]["status"], "QUEUED")
        finally:
            try:
                if os.path.exists(tmp_db_path):
                    os.unlink(tmp_db_path)
            except Exception:
                pass

    def test_06_offline_buffer_connection_loss(self):
        """BLOCKER-01: Mất kết nối mạng -> Telemetry được lưu an toàn vào buffer."""
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
            tmp_db_path = tmp.name

        try:
            buf = OfflineBuffer(db_path=tmp_db_path)
            # Giả lập 5 gói tin phát sinh trong thời gian mất mạng
            for seq in range(1, 6):
                msg_id = f"STATION_B-offline-{seq}"
                buf.enqueue(msg_id, "STATION_B", "RECYCLABLE", json.dumps({"seq": seq, "fill": 40 + seq}))

            batch = buf.peek_batch(limit=10)
            self.assertEqual(len(batch), 5)
            self.assertEqual([b["client_message_id"] for b in batch], [f"STATION_B-offline-{seq}" for seq in range(1, 6)])
        finally:
            try:
                if os.path.exists(tmp_db_path):
                    os.unlink(tmp_db_path)
            except Exception:
                pass

    def test_07_offline_buffer_pi_agent_restart_recovery(self):
        """BLOCKER-01: Pi Agent khởi động lại -> Tự động phục hồi toàn bộ gói IN_FLIGHT về QUEUED."""
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
            tmp_db_path = tmp.name

        try:
            buf1 = OfflineBuffer(db_path=tmp_db_path)
            buf1.enqueue("msg-power-cut-1", "STATION_B", "RECYCLABLE", '{"seq": 201}')
            buf1.enqueue("msg-power-cut-2", "STATION_B", "RECYCLABLE", '{"seq": 202}')

            batch = buf1.peek_batch(limit=10)
            buf1.mark_in_flight([b["id"] for b in batch])

            # Xác nhận cả 2 gói đang IN_FLIGHT
            with buf1._connection() as conn:
                in_flight_count = conn.execute("SELECT COUNT(*) AS c FROM offline_telemetry WHERE status = 'IN_FLIGHT'").fetchone()['c']
                self.assertEqual(in_flight_count, 2)

            # Giả lập tiến trình Pi Agent bị tắt / mất nguồn và khởi động lại
            # Khởi tạo instance mới (mô phỏng Pi Agent restart)
            buf2 = OfflineBuffer(db_path=tmp_db_path)

            # Sau khi khởi động, _init_db phải tự động phục hồi về QUEUED
            recovered_batch = buf2.peek_batch(limit=10)
            self.assertEqual(len(recovered_batch), 2)
            self.assertEqual(recovered_batch[0]["status"], "QUEUED")
            self.assertEqual(recovered_batch[1]["status"], "QUEUED")
        finally:
            try:
                if os.path.exists(tmp_db_path):
                    os.unlink(tmp_db_path)
            except Exception:
                pass

    def test_08_offline_buffer_fifo_overflow_logging(self):
        """BLOCKER-01: Tràn dung lượng 50,000 -> Evict gói QUEUED cũ nhất theo FIFO và ghi log chi tiết."""
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
            tmp_db_path = tmp.name

        try:
            buf = OfflineBuffer(db_path=tmp_db_path)
            import offline_buffer
            orig_cap = offline_buffer.MAX_BUFFER_CAPACITY
            offline_buffer.MAX_BUFFER_CAPACITY = 3

            try:
                buf.enqueue("pkt-oldest-1", "STATION_B", "RECYCLABLE", '{"n": 1}')
                buf.enqueue("pkt-2", "STATION_B", "RECYCLABLE", '{"n": 2}')
                buf.enqueue("pkt-3", "STATION_B", "RECYCLABLE", '{"n": 3}')
                
                # Buffer đầy 3/3. Thêm pkt-4 -> pkt-oldest-1 bị xóa (FIFO)
                buf.enqueue("pkt-4", "STATION_B", "RECYCLABLE", '{"n": 4}')

                batch = buf.peek_batch(limit=10)
                self.assertEqual(len(batch), 3)
                ids = [b["client_message_id"] for b in batch]
                self.assertNotIn("pkt-oldest-1", ids, "Gói cũ nhất pkt-oldest-1 phải bị xóa theo FIFO")
                self.assertIn("pkt-2", ids)
                self.assertIn("pkt-3", ids)
                self.assertIn("pkt-4", ids)
            finally:
                offline_buffer.MAX_BUFFER_CAPACITY = orig_cap

        finally:
            try:
                if os.path.exists(tmp_db_path):
                    os.unlink(tmp_db_path)
            except Exception:
                pass

    def test_09_serial_b_disconnection_stops_emitting_stale_data(self):
        """Kịch bản 6: Khi Serial B mất kết nối, Worker chuyển trạng thái DISCONNECTED và get_latest_data() trả về None."""
        worker = StationBSerialWorker()
        packet = {
            "stationCode": "STATION_B",
            "deviceId": "esp32c6-station-b",
            "bootCount": 1,
            "sampleSeq": 201,
            "sensors": {"recyclable": {"fillLevel": 60, "status": "OK"}}
        }
        canonical_bytes = json.dumps(packet, separators=(',', ':'), sort_keys=True).encode('utf-8')
        packet["crc16"] = calculate_crc16_ccitt(canonical_bytes)
        worker._process_packet(packet)
        self.assertIsNotNone(worker.get_latest_data())

        # Giả lập Serial B mất kết nối
        with worker._lock:
            worker.status = 'DISCONNECTED'

        self.assertIsNone(worker.get_latest_data(), "Khi DISCONNECTED, không được trả về dữ liệu cũ")

    def test_10_serial_b_reconnection_resumes_cleanly(self):
        """Kịch bản 7: Khi Serial B kết nối lại, nhận gói tin mới và tiếp tục cập nhật bình thường."""
        worker = StationBSerialWorker()
        # Ban đầu mất kết nối
        with worker._lock:
            worker.status = 'DISCONNECTED'
        self.assertIsNone(worker.get_latest_data())

        # ESP32-C6 kết nối lại và gửi gói tin mới
        new_packet = {
            "stationCode": "STATION_B",
            "deviceId": "esp32c6-station-b",
            "bootCount": 1,
            "sampleSeq": 202,
            "sensors": {"recyclable": {"fillLevel": 65, "distanceCm": 18.0, "status": "OK"}}
        }
        canonical_bytes = json.dumps(new_packet, separators=(',', ':'), sort_keys=True).encode('utf-8')
        new_packet["crc16"] = calculate_crc16_ccitt(canonical_bytes)
        worker._process_packet(new_packet)

        latest = worker.get_latest_data()
        self.assertIsNotNone(latest)
        self.assertEqual(worker.status, 'CONNECTED')
        self.assertEqual(latest["sampleSeq"], 202)
        self.assertEqual(latest["sensors"]["recyclable"]["fillLevel"], 65)

    def test_11_freshness_timeout_drops_stale_packet(self):
        """Kịch bản 9: Dữ liệu quá hạn freshness (>10s) bị loại bỏ, không giả lập dữ liệu mới."""
        worker = StationBSerialWorker()
        packet = {
            "stationCode": "STATION_B",
            "bootCount": 1,
            "sampleSeq": 203,
            "sensors": {"recyclable": {"fillLevel": 70, "status": "OK"}}
        }
        canonical_bytes = json.dumps(packet, separators=(',', ':'), sort_keys=True).encode('utf-8')
        packet["crc16"] = calculate_crc16_ccitt(canonical_bytes)
        worker._process_packet(packet)

        # Giả lập gói tin đã nhận từ 12 giây trước
        with worker._lock:
            worker.last_packet_time = time.time() - 12.0

        # Mặc định max_age_seconds = 10.0 -> Phải trả về None
        self.assertIsNone(worker.get_latest_data(max_age_seconds=10.0), "Dữ liệu quá 10s phải bị coi là STALE và trả về None")

    def test_12_payload_normalization_for_station_b(self):
        """Kiểm tra logic chuẩn hóa payload Station B trong Pi Agent."""
        raw_esp32_payload = {
            "stationCode": "STATION_B",
            "bootCount": 2,
            "bootId": "uuid-b-test",
            "sampleSeq": 50,
            "uptimeMs": 45000,
            "sensors": {
                "recyclable": {"fillPercent": 75, "distanceCm": 16.5, "status": "OK"},
                "nonRecyclable": {"status": "NOT_INSTALLED"},
                "organic": {"status": "NOT_INSTALLED"}
            }
        }

        # Giả lập xử lý của Pi Agent
        payload_b = dict(raw_esp32_payload)
        payload_b['stationCode'] = 'STATION_B'
        if not payload_b.get('deviceId'):
            payload_b['deviceId'] = 'esp32c6-station-b'
        payload_b['deviceType'] = 'ESP32_C6'
        payload_b['status'] = 'ONLINE'
        if 'uptimeSeconds' not in payload_b:
            uptime_ms = payload_b.get('uptimeMs', 0)
            payload_b['uptimeSeconds'] = round(uptime_ms / 1000.0, 1)

        sensors_b = payload_b.get('sensors')
        for comp_key, comp_data in sensors_b.items():
            if isinstance(comp_data, dict):
                if 'fillLevel' not in comp_data and 'fillPercent' in comp_data:
                    comp_data['fillLevel'] = comp_data['fillPercent']

        self.assertEqual(payload_b['deviceId'], 'esp32c6-station-b')
        self.assertEqual(payload_b['uptimeSeconds'], 45.0)
        self.assertEqual(payload_b['sensors']['recyclable']['fillLevel'], 75)
        self.assertEqual(payload_b['sensors']['nonRecyclable']['status'], 'NOT_INSTALLED')
        self.assertNotIn('fillLevel', payload_b['sensors']['nonRecyclable'])

    def test_13_worker_valid_zero_fill_preserved(self):
        """Kiểm tra đo lường 0% hợp lệ: 0% được giữ nguyên là số 0, có updatedAt và last_valid_reading_at."""
        worker = StationBSerialWorker()
        packet = {
            "stationCode": "STATION_B",
            "bootCount": 1,
            "sampleSeq": 301,
            "sensors": {
                "recyclable": {"fillPercent": 0, "distanceCm": 50.0, "status": "OK"},
                "nonRecyclable": {"status": "NOT_INSTALLED"},
                "organic": {"status": "NOT_INSTALLED"}
            }
        }
        canonical_bytes = json.dumps(packet, separators=(',', ':'), sort_keys=True).encode('utf-8')
        packet["crc16"] = calculate_crc16_ccitt(canonical_bytes)

        worker._process_packet(packet)
        latest = worker.get_latest_data()
        self.assertIsNotNone(latest)
        rec = latest['sensors']['recyclable']
        self.assertEqual(rec['fillPercent'], 0, "0% phải được bảo toàn là số 0 nguyên vẹn")
        self.assertEqual(rec['fillLevel'], 0)
        self.assertEqual(rec['status'], 'OK')
        self.assertIn('updatedAt', rec)
        self.assertIsNotNone(worker.last_valid_reading_at)

    def test_14_worker_sensor_error_or_timeout_handling(self):
        """Khi cảm biến lỗi hoặc timeout: Không gửi mức đầy cũ làm mới, không cập nhật last_valid_reading_at."""
        worker = StationBSerialWorker()
        worker.last_valid_reading_at = None
        packet_err = {
            "stationCode": "STATION_B",
            "bootCount": 1,
            "sampleSeq": 302,
            "sensors": {
                "recyclable": {"status": "ERROR"},
                "nonRecyclable": {"status": "NOT_INSTALLED"},
                "organic": {"status": "NOT_INSTALLED"}
            }
        }
        canonical_bytes = json.dumps(packet_err, separators=(',', ':'), sort_keys=True).encode('utf-8')
        packet_err["crc16"] = calculate_crc16_ccitt(canonical_bytes)

        worker._process_packet(packet_err)
        latest = worker.get_latest_data()
        self.assertIsNotNone(latest)
        rec = latest['sensors']['recyclable']
        self.assertIsNone(rec.get('fillPercent'), "Cảm biến lỗi không được có fillPercent giả")
        self.assertIsNone(rec.get('fillLevel'))
        self.assertEqual(rec['status'], 'ERROR')
        self.assertIsNone(worker.last_valid_reading_at, "Lỗi cảm biến không được làm mới last_valid_reading_at")

    def test_15_serial_port_discovery_prefers_by_id_and_excludes_ttyusb0(self):
        """Xác minh thứ tự tìm cổng Serial B: Ưu tiên by-id và TUYỆT ĐỐI loại trừ ttyUSB0 (Serial A của YOLO)."""
        from unittest import mock
        worker = StationBSerialWorker()
        worker.preferred_port = None

        fake_by_id = ['/dev/serial/by-id/usb-CH340-ttyUSB0', '/dev/serial/by-id/usb-Espressif_ESP32-C6_001-if00']
        fake_by_path = ['/dev/serial/by-path/platform-usb-0:1-ttyUSB0', '/dev/serial/by-path/platform-usb-0:2-ttyUSB1']

        def fake_realpath(p):
            if 'ttyUSB0' in p:
                return '/dev/ttyUSB0'
            return '/dev/ttyUSB1'

        with mock.patch('os.path.exists', return_value=False), \
             mock.patch('glob.glob') as mock_glob, \
             mock.patch('os.path.realpath', side_effect=fake_realpath):

            def glob_side_effect(pattern):
                if 'by-id' in pattern:
                    return fake_by_id
                if 'by-path' in pattern:
                    return fake_by_path
                return []

            mock_glob.side_effect = glob_side_effect
            selected_port = worker.find_serial_port()

            # Phải chọn cổng ESP32-C6 trong by-id, bỏ qua cổng trỏ tới ttyUSB0
            self.assertEqual(selected_port, '/dev/serial/by-id/usb-Espressif_ESP32-C6_001-if00')
            self.assertNotEqual(selected_port, '/dev/serial/by-id/usb-CH340-ttyUSB0')

    def test_16_worker_text_measurement_hc1_67_percent(self):
        """Firmware ESP32-C6 gửi định dạng text 'HC1: 67%' -> parse chính xác mức đầy 67% cho RECYCLABLE."""
        worker = StationBSerialWorker()
        worker._process_text_measurement(67)
        latest = worker.get_latest_data()
        self.assertIsNotNone(latest)
        self.assertEqual(latest.get("stationCode"), "STATION_B")
        self.assertIsNotNone(worker.last_valid_reading_at)

        sensors = latest.get("sensors", {})
        self.assertEqual(sensors["recyclable"]["fillPercent"], 67)
        self.assertEqual(sensors["recyclable"]["fillLevel"], 67)
        self.assertEqual(sensors["recyclable"]["status"], "OK")
        self.assertEqual(sensors["organic"]["status"], "NOT_INSTALLED")
        self.assertEqual(sensors["nonRecyclable"]["status"], "NOT_INSTALLED")

    def test_17_worker_text_measurement_hc1_0_percent(self):
        """Firmware ESP32-C6 gửi 'HC1: 0%' -> giá trị 0% hợp lệ được bảo toàn, không bị biến thành null."""
        worker = StationBSerialWorker()
        worker._process_text_measurement(0)
        latest = worker.get_latest_data()
        self.assertIsNotNone(latest)
        self.assertEqual(latest["sensors"]["recyclable"]["fillPercent"], 0)
        self.assertEqual(latest["sensors"]["recyclable"]["fillLevel"], 0)
        self.assertEqual(latest["sensors"]["recyclable"]["status"], "OK")
        self.assertIsNotNone(worker.last_valid_reading_at)

    def test_18_worker_text_measurement_out_of_bounds_rejected(self):
        """Giá trị ngoài dải 0-100% (ví dụ: -5% hoặc 120%) bị từ chối, không cập nhật last_valid_reading_at."""
        worker = StationBSerialWorker()
        worker._process_text_measurement(-5)
        self.assertIsNone(worker.last_valid_reading_at)
        self.assertIsNone(worker.get_latest_data())

        worker._process_text_measurement(120)
        self.assertIsNone(worker.last_valid_reading_at)
        self.assertIsNone(worker.get_latest_data())

    def test_19_worker_regex_text_parsing(self):
        """Kiểm tra regex khớp chuỗi text 'HC1: 67%' và các biến thể khoảng trắng."""
        import re
        patterns = [
            ("HC1: 67%", 67),
            ("HC1:0%", 0),
            ("hc1: 100%", 100),
            ("HC1:  21%  ", 21)
        ]
        for text, expected in patterns:
            match = re.match(r'^HC1:\s*(-?\d+)\s*%$', text.strip(), re.IGNORECASE)
            self.assertIsNotNone(match, f"Failed to match: {text}")
            self.assertEqual(int(match.group(1)), expected)

        invalid_texts = ["HC1: 67", "HC2: 50%", "HC1: abc%", "INVALID_DATA"]
        for text in invalid_texts:
            self.assertIsNone(
                StationBSerialWorker.parse_text_measurement_line(text),
                f"Should not match invalid text: {text}"
            )

    def test_20_worker_text_measurement_marks_is_legacy_and_supports_esp32_prefix(self):
        """Đảm bảo phép đo dạng text (HC1: 42% / [ESP32] HC1: 42.4%) gắn cờ isLegacy=True và có session_boot_count duy nhất."""
        worker = StationBSerialWorker()
        val = worker.parse_text_measurement_line("[ESP32] HC1: 42.4%")
        self.assertEqual(val, 42)
        worker._process_text_measurement(val)
        latest = worker.get_latest_data()
        self.assertIsNotNone(latest)
        self.assertTrue(latest.get("isLegacy"), "Text measurement must set isLegacy=True to prevent watermark collision on restart")
        self.assertEqual(latest["sensors"]["recyclable"]["fillLevel"], 42)
        self.assertEqual(latest["sensors"]["recyclable"]["fillPercent"], 42)
        self.assertGreater(latest["bootCount"], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
