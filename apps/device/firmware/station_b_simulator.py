#!/usr/bin/env python3
"""
ESP32-C6 Simulator for SmartBin Station B.
Mô phỏng vi điều khiển ESP32-C6 phát gói tin NDJSON kèm CRC16 qua Serial/Pipe:
- Cấu hình: Chỉ có RECYCLABLE được lắp đặt; NON_RECYCLABLE và ORGANIC mang trạng thái NOT_INSTALLED.
- Sinh sequence tăng dần, bootCount, bootId UUIDv4.
- Dùng cho kiểm thử tích hợp tự động (Integration Testing).
"""

import json
import uuid
import time
import random
from typing import Dict, Any

def calculate_crc16_ccitt(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= (byte << 8)
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc

class ESP32C6Simulator:
    def __init__(self, boot_count: int = 1, boot_id: str = None):
        self.boot_count = boot_count
        self.boot_id = boot_id or str(uuid.uuid4())
        self.sample_seq = 0
        self.start_time = time.time()

    def generate_packet(self, fill_percent: int = None, distance_cm: float = None) -> Dict[str, Any]:
        self.sample_seq += 1
        uptime_ms = int((time.time() - self.start_time) * 1000)

        if fill_percent is None:
            fill_percent = random.randint(15, 85)
        if distance_cm is None:
            distance_cm = round(50.0 - (fill_percent * 45.0 / 100.0), 1)

        payload = {
            "stationCode": "STATION_B",
            "bootCount": self.boot_count,
            "bootId": self.boot_id,
            "sampleSeq": self.sample_seq,
            "uptimeMs": uptime_ms,
            "sensors": {
                "recyclable": {
                    "distanceCm": distance_cm,
                    "fillPercent": fill_percent,
                    "status": "OK"
                },
                "nonRecyclable": {
                    "status": "NOT_INSTALLED"
                },
                "organic": {
                    "status": "NOT_INSTALLED"
                }
            }
        }

        # Tính toán Checksum CRC16
        canonical_bytes = json.dumps(payload, separators=(',', ':'), sort_keys=True).encode('utf-8')
        payload['crc16'] = calculate_crc16_ccitt(canonical_bytes)
        return payload

    def generate_ndjson_line(self, fill_percent: int = None) -> str:
        pkt = self.generate_packet(fill_percent=fill_percent)
        return json.dumps(pkt) + '\n'

if __name__ == '__main__':
    sim = ESP32C6Simulator(boot_count=1)
    print("Simulating ESP32-C6 Station B output:")
    for _ in range(3):
        print(sim.generate_ndjson_line())
        time.sleep(1)

