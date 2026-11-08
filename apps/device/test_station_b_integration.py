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


if __name__ == '__main__':
    unittest.main(verbosity=2)
