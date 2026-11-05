#!/usr/bin/env python3
"""
SmartBin YOLO Bridge
Module cầu nối trạng thái giữa chương trình YOLO (ví dụ: ~/Desktop/yolo_camera.py)
và Pi Agent (pi_agent.py).

Đặc điểm:
1. Giao tiếp qua file trạng thái nguyên tử (Atomic JSON state file) tại /tmp/smartbin_yolo_state.json.
2. Không can thiệp hoặc thay đổi thuật toán nhận diện của chương trình YOLO hiện có.
3. Cho phép chạy độc lập (Interactive mode trên Desktop) hoặc tự động (Headless mode).
4. Chuẩn hóa confidence về số thực [0.0, 1.0].
5. Tự động phát hiện khi tiến trình YOLO dừng hoạt động (stale timeout 5s).
"""

import os
import time
import json
import tempfile
from datetime import datetime, timezone
from typing import Dict, Any, Optional

STATE_FILE_PATH = os.getenv('SMARTBIN_YOLO_STATE_FILE', os.path.join(tempfile.gettempdir(), 'smartbin_yolo_state.json'))
STALE_TIMEOUT_SEC = 5.0

# Bảng ánh xạ nhãn rác SmartBin
CANONICAL_CLASSES = {
    'organic': 'ORGANIC',
    'recyclable': 'RECYCLABLE',
    'non_recyclable': 'NON_RECYCLABLE'
}


def normalize_class(raw_class: str) -> str:
    """Chuẩn hóa nhãn lớp nếu khớp từ khóa, giữ nguyên nếu không ánh xạ được."""
    if not raw_class:
        return 'UNKNOWN'
    cleaned = str(raw_class).strip().lower().replace(' ', '_')
    if any(k in cleaned for k in ['recycle', 'bottle', 'can', 'plastic', 'paper', 'cardboard', 'glass', 'box']):
        return 'RECYCLABLE'
    if any(k in cleaned for k in ['organ', 'food', 'fruit', 'veg', 'banana', 'apple', 'orange', 'bread', 'leaf']):
        return 'ORGANIC'
    if any(k in cleaned for k in ['battery', 'trash', 'styrofoam', 'mask', 'diaper', 'ceramic', 'non_recycl']):
        return 'NON_RECYCLABLE'
    # Không tự ý gán nhãn nếu không ánh xạ được
    return raw_class.upper()


def export_detection(
    raw_class: str,
    confidence: float,
    inference_ms: Optional[float] = None,
    camera_status: str = 'CONNECTED',
    box: Optional[list] = None
) -> bool:
    """
    Hàm xuất kết quả nhận diện từ yolo_camera.py sang Pi Agent.
    Được gọi ở cuối mỗi vòng lặp inference của yolo_camera.py.
    """
    try:
        # Chuẩn hóa confidence về số thực [0.0, 1.0]
        conf_float = float(confidence)
        if conf_float > 1.0:
            conf_float = conf_float / 100.0
        conf_float = max(0.0, min(1.0, round(conf_float, 4)))

        canonical_cls = normalize_class(raw_class)

        payload = {
            'pid': os.getpid(),
            'status': 'RUNNING',
            'camera': camera_status,
            'class': canonical_cls,
            'rawClass': str(raw_class),
            'confidence': conf_float,
            'inferenceTimeMs': round(float(inference_ms), 1) if inference_ms is not None else None,
            'box': box,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'updatedAtEpoch': time.time()
        }

        # Ghi file nguyên tử (Atomic write) qua temp file để tránh race condition khi Pi Agent đọc
        dir_name = os.path.dirname(STATE_FILE_PATH) or '/tmp'
        with tempfile.NamedTemporaryFile('w', dir=dir_name, delete=False, encoding='utf-8') as tf:
            json.dump(payload, tf)
            temp_name = tf.name

        os.replace(temp_name, STATE_FILE_PATH)
        return True
    except Exception:
        return False


def read_yolo_state() -> Dict[str, Any]:
    """
    Pi Agent đọc trạng thái YOLO từ file cầu nối.
    Trả về thông tin tiến trình, trạng thái Camera và kết quả nhận diện gần nhất.
    """
    if not os.path.exists(STATE_FILE_PATH):
        return {
            'yoloStatus': 'STOPPED',
            'cameraStatus': 'DISCONNECTED',
            'latestDetection': None,
            'lastInferenceTimeMs': None
        }

    try:
        with open(STATE_FILE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)

        updated_epoch = data.get('updatedAtEpoch', 0)
        age = time.time() - updated_epoch

        # Nếu file đã quá 5s không được yolo_camera.py cập nhật -> Tiến trình YOLO đã dừng
        if age > STALE_TIMEOUT_SEC:
            return {
                'yoloStatus': 'STOPPED',
                'cameraStatus': 'DISCONNECTED',
                'latestDetection': None,
                'lastInferenceTimeMs': None
            }

        # Kiểm tra PID của tiến trình YOLO
        pid = data.get('pid')
        if pid:
            try:
                os.kill(pid, 0)
            except OSError:
                # Tiến trình đã chết
                return {
                    'yoloStatus': 'STOPPED',
                    'cameraStatus': 'DISCONNECTED',
                    'latestDetection': None,
                    'lastInferenceTimeMs': None
                }

        latest_detection = None
        if data.get('class'):
            latest_detection = {
                'class': data.get('class'),
                'rawClass': data.get('rawClass'),
                'confidence': data.get('confidence'),
                'inferenceTimeMs': data.get('inferenceTimeMs'),
                'timestamp': data.get('timestamp')
            }

        return {
            'yoloStatus': data.get('status', 'RUNNING'),
            'cameraStatus': data.get('camera', 'CONNECTED'),
            'latestDetection': latest_detection,
            'lastInferenceTimeMs': data.get('inferenceTimeMs')
        }
    except Exception:
        return {
            'yoloStatus': 'ERROR',
            'cameraStatus': 'DISCONNECTED',
            'latestDetection': None,
            'lastInferenceTimeMs': None
        }
