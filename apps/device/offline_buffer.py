#!/usr/bin/env python3
"""
SmartBin SQLite Offline Buffer for Raspberry Pi 5 Gateway.
Cơ chế đệm ngoại tuyến lưu trữ tối đa 50,000 gói tin telemetry khi mất kết nối mạng:
- Lưu vết trạng thái: QUEUED, IN_FLIGHT, ACKED, EXPIRED.
- Chính sách thu dọn: Ưu tiên xóa ACKED, sau đó xóa EXPIRED (> 7 ngày).
- Nếu đầy 100% (50,000 gói QUEUED): Xóa FIFO kèm cảnh báo BUFFER_OVERFLOW.
"""

import os
import time
import sqlite3
import logging
from contextlib import contextmanager
from typing import List, Dict, Any, Optional

logger = logging.getLogger('SmartBin-OfflineBuffer')

MAX_BUFFER_CAPACITY = 50000
RETENTION_TTL_SECONDS = 7 * 24 * 3600  # 7 ngày

class OfflineBuffer:
    def __init__(self, db_path: Optional[str] = None):
        if not db_path:
            db_dir = os.getenv('SMARTBIN_DATA_DIR', '/var/lib/smartbin')
            if not os.path.exists(db_dir):
                try:
                    os.makedirs(db_dir, exist_ok=True)
                except Exception:
                    db_dir = os.path.dirname(os.path.abspath(__file__))
            db_path = os.path.join(db_dir, 'offline_buffer.db')

        self.db_path = db_path
        self._init_db()

    @contextmanager
    def _connection(self):
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def _init_db(self):
        try:
            with self._connection() as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS offline_telemetry (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        client_message_id TEXT NOT NULL UNIQUE,
                        station_code TEXT NOT NULL,
                        bin_code TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'QUEUED',
                        retry_count INTEGER NOT NULL DEFAULT 0,
                        created_at INTEGER NOT NULL,
                        last_attempt_at INTEGER
                    )
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_offline_status_created ON offline_telemetry (status, created_at)")
                
                # PHỤC HỒI SAU KHI RESTART: Chuyển toàn bộ gói kẹt IN_FLIGHT về QUEUED để retry an toàn
                recovered = conn.execute("UPDATE offline_telemetry SET status = 'QUEUED' WHERE status = 'IN_FLIGHT'").rowcount
                if recovered > 0:
                    logger.warning("Đã phục hồi %d gói tin IN_FLIGHT về trạng thái QUEUED sau khi khởi động lại.", recovered)

                conn.commit()
            logger.info("Initialized SQLite Offline Buffer at %s", self.db_path)
        except Exception as e:
            logger.error("Failed to initialize SQLite Offline Buffer: %s", e)

    def recover_in_flight(self) -> int:
        """Phục hồi thủ công các gói tin IN_FLIGHT về QUEUED."""
        try:
            with self._connection() as conn:
                cursor = conn.execute("UPDATE offline_telemetry SET status = 'QUEUED' WHERE status = 'IN_FLIGHT'")
                conn.commit()
                return cursor.rowcount
        except Exception as e:
            logger.error("Error recovering in-flight records: %s", e)
            return 0

    def enqueue(self, client_message_id: str, station_code: str, bin_code: str, payload_json: str) -> bool:
        """Thêm gói tin vào hàng đợi SQLite."""
        try:
            with self._connection() as conn:
                # Kiểm tra dung lượng
                cursor = conn.execute("SELECT COUNT(*) AS count FROM offline_telemetry WHERE status != 'ACKED'")
                row = cursor.fetchone()
                count = row['count'] if row else 0

                if count >= MAX_BUFFER_CAPACITY:
                    # Thu dọn bản ghi hết hạn (> 7 ngày)
                    now_ms = int(time.time() * 1000)
                    cutoff_ms = now_ms - (RETENTION_TTL_SECONDS * 1000)
                    conn.execute("DELETE FROM offline_telemetry WHERE created_at < ? OR status = 'ACKED'", (cutoff_ms,))

                    # Nếu vẫn đầy: xóa gói QUEUED cũ nhất theo nguyên tắc FIFO
                    cursor = conn.execute("SELECT COUNT(*) AS count FROM offline_telemetry WHERE status != 'ACKED'")
                    if cursor.fetchone()['count'] >= MAX_BUFFER_CAPACITY:
                        oldest_cursor = conn.execute("SELECT id, client_message_id, station_code, created_at FROM offline_telemetry WHERE status = 'QUEUED' ORDER BY id ASC LIMIT 1")
                        oldest = oldest_cursor.fetchone()
                        if oldest:
                            logger.critical(
                                "BUFFER_OVERFLOW: FIFO eviction of un-ACKed packet! Dropped id=%s, msgId=%s, station=%s, createdAt=%s",
                                oldest['id'], oldest['client_message_id'], oldest['station_code'], oldest['created_at']
                            )
                            conn.execute("DELETE FROM offline_telemetry WHERE id = ?", (oldest['id'],))

                now_ms = int(time.time() * 1000)
                conn.execute("""
                    INSERT OR REPLACE INTO offline_telemetry 
                    (client_message_id, station_code, bin_code, payload_json, status, created_at)
                    VALUES (?, ?, ?, ?, 'QUEUED', ?)
                """, (client_message_id, station_code, bin_code, payload_json, now_ms))
                conn.commit()
                return True
        except Exception as e:
            logger.error("Error enqueuing packet %s: %s", client_message_id, e)
            return False

    def peek_batch(self, limit = 50) -> List[Dict[str, Any]]:
        """Lấy một lô gói tin đang chờ gửi."""
        try:
            with self._connection() as conn:
                cursor = conn.execute("""
                    SELECT id, client_message_id, station_code, bin_code, payload_json, status, retry_count
                    FROM offline_telemetry
                    WHERE status = 'QUEUED'
                    ORDER BY id ASC
                    LIMIT ?
                """, (limit,))
                rows = cursor.fetchall()
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error("Error peeking offline buffer batch: %s", e)
            return []

    def mark_in_flight(self, ids: List[int]):
        """Đánh dấu các gói tin đang được gửi."""
        if not ids:
            return
        try:
            with self._connection() as conn:
                now_ms = int(time.time() * 1000)
                placeholders = ','.join('?' for _ in ids)
                conn.execute(f"""
                    UPDATE offline_telemetry 
                    SET status = 'IN_FLIGHT', last_attempt_at = ?, retry_count = retry_count + 1
                    WHERE id IN ({placeholders})
                """, [now_ms] + ids)
                conn.commit()
        except Exception as e:
            logger.error("Error marking in-flight: %s", e)

    def mark_acked(self, client_message_ids: List[str]):
        """Đánh dấu các gói tin đã được Backend xác nhận thành công."""
        if not client_message_ids:
            return
        try:
            with self._connection() as conn:
                placeholders = ','.join('?' for _ in client_message_ids)
                conn.execute(f"""
                    UPDATE offline_telemetry 
                    SET status = 'ACKED'
                    WHERE client_message_id IN ({placeholders})
                """, client_message_ids)
                conn.commit()
        except Exception as e:
            logger.error("Error marking acked: %s", e)

    def mark_failed(self, client_message_ids: List[str]):
        """Khôi phục các gói tin gửi thất bại/timeout về trạng thái QUEUED để thử lại."""
        if not client_message_ids:
            return
        try:
            with self._connection() as conn:
                placeholders = ','.join('?' for _ in client_message_ids)
                conn.execute(f"""
                    UPDATE offline_telemetry 
                    SET status = 'QUEUED'
                    WHERE client_message_id IN ({placeholders})
                """, client_message_ids)
                conn.commit()
        except Exception as e:
            logger.error("Error marking failed for retry: %s", e)

    def prune_acked(self):
        """Xóa vĩnh viễn các bản ghi đã ACK để giải phóng đĩa."""
        try:
            with self._connection() as conn:
                conn.execute("DELETE FROM offline_telemetry WHERE status = 'ACKED'")
                conn.commit()
        except Exception:
            pass
