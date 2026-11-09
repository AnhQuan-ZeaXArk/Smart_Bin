#!/usr/bin/env python3
"""Atomic, read-only-from-Agent YOLO IPC contract."""

import json
import logging
import math
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

STATE_FILE_PATH = os.getenv('SMARTBIN_YOLO_STATE_FILE', '/tmp/smartbin_yolo_state.json')
logger = logging.getLogger('SmartBin-YOLO-IPC')
try:
    STALE_TIMEOUT_SEC = float(os.getenv('SMARTBIN_YOLO_STALE_TIMEOUT_SEC', '10'))
except ValueError:
    logger.warning("Invalid SMARTBIN_YOLO_STALE_TIMEOUT_SEC; using 10 seconds.")
    STALE_TIMEOUT_SEC = 10.0
if not math.isfinite(STALE_TIMEOUT_SEC) or STALE_TIMEOUT_SEC <= 0:
    logger.warning("Invalid SMARTBIN_YOLO_STALE_TIMEOUT_SEC; using 10 seconds.")
    STALE_TIMEOUT_SEC = 10.0

VALID_DETECTION_CLASSES = frozenset({'taiche', 'khongtaiche', 'huuco'})
VALID_SENSOR_KEYS = frozenset({'hc1', 'hc2', 'hc3'})
HC_VALID_TIMEOUT_SEC = 15.0


def normalize_fill_level(value: Any) -> Optional[int]:
    """
    Safely normalize fill level to an integer between 0 and 100.
    - Accepts int, finite float, numeric strings (e.g. '45', '45.7', '45%').
    - Rejects booleans (True/False).
    - Rejects None, NaN, Infinity, empty strings, non-numeric strings.
    - Rejects values < 0 or > 100.
    - Normalizes accepted values to int using round().
    - Returns None if invalid (never converts invalid or missing data to 0).
    """
    if value is None or isinstance(value, bool):
        return None

    num: float
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            return None
        num = float(value)
    elif isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        if cleaned.endswith('%'):
            cleaned = cleaned[:-1].strip()
        try:
            num = float(cleaned)
            if not math.isfinite(num):
                return None
        except (ValueError, TypeError):
            return None
    else:
        return None

    if 0.0 <= num <= 100.0:
        return int(round(num))
    return None


def normalize_class(raw_class: str) -> str:
    """Keep the legacy label helper available to existing local tooling."""
    if not raw_class:
        return 'UNKNOWN'
    cleaned = str(raw_class).strip().lower().replace(' ', '_')
    if any(k in cleaned for k in ['recycle', 'bottle', 'can', 'plastic', 'paper', 'cardboard', 'glass', 'box']):
        return 'RECYCLABLE'
    if any(k in cleaned for k in ['organ', 'food', 'fruit', 'veg', 'banana', 'apple', 'orange', 'bread', 'leaf']):
        return 'ORGANIC'
    if any(k in cleaned for k in ['battery', 'trash', 'styrofoam', 'mask', 'diaper', 'ceramic', 'non_recycl']):
        return 'NON_RECYCLABLE'
    return raw_class.upper()


def _valid_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() == timedelta(0)


def _valid_detection(detection: Any) -> bool:
    if detection is None:
        return True
    if not isinstance(detection, dict) or set(detection) != {'class', 'confidence', 'timestamp'}:
        return False

    confidence = detection['confidence']
    detection_class = detection['class']
    return (
        isinstance(detection_class, str)
        and detection_class in VALID_DETECTION_CLASSES
        and not isinstance(confidence, bool)
        and isinstance(confidence, (int, float))
        and math.isfinite(confidence)
        and 0 <= confidence <= 1
        and _valid_timestamp(detection['timestamp'])
    )


def _sanitize_sensors_for_publish(sensors: Any) -> Optional[Dict[str, Optional[Dict[str, Any]]]]:
    if sensors is None:
        return None
    if not isinstance(sensors, dict):
        return None
    sanitized: Dict[str, Optional[Dict[str, Any]]] = {}
    for key in ('hc1', 'hc2', 'hc3'):
        entry = sensors.get(key)
        if entry is None:
            sanitized[key] = None
            continue
        if isinstance(entry, dict):
            fill = entry.get('fillPercent')
            norm_fill = normalize_fill_level(fill)
            epoch = entry.get('updatedAtEpoch')
            if (
                norm_fill is not None
                and isinstance(epoch, (int, float))
                and not isinstance(epoch, bool)
                and math.isfinite(epoch)
            ):
                sanitized[key] = {
                    'fillPercent': norm_fill,
                    'updatedAtEpoch': float(epoch)
                }
            else:
                sanitized[key] = None
        else:
            sanitized[key] = None
    return sanitized


def publish_yolo_state(
    detection: Optional[Dict[str, Any]] = None,
    status: str = 'RUNNING',
    camera: str = 'CONNECTED',
    sensors: Optional[Dict[str, Any]] = None
) -> bool:
    """Write one complete state to a same-directory temporary file and replace atomically."""
    if status not in ('RUNNING', 'STOPPED') or camera not in ('CONNECTED', 'DISCONNECTED'):
        logger.error("Refusing to publish invalid YOLO IPC status.")
        return False
    if status == 'RUNNING' and camera != 'CONNECTED':
        logger.error("Refusing to publish RUNNING YOLO IPC with a disconnected camera.")
        return False
    if status == 'STOPPED' and (camera != 'DISCONNECTED' or detection is not None):
        logger.error("Refusing to publish STOPPED YOLO IPC with active state.")
        return False
    if not _valid_detection(detection):
        logger.error("Refusing to publish invalid YOLO IPC detection.")
        return False

    state = {
        'status': status,
        'camera': camera,
        'updatedAtEpoch': time.time(),
        'detection': None if detection is None else {
            'class': detection['class'],
            'confidence': float(detection['confidence']),
            'timestamp': detection['timestamp']
        }
    }
    sanitized_sensors = _sanitize_sensors_for_publish(sensors)
    if sanitized_sensors is not None:
        state['sensors'] = sanitized_sensors

    temporary_path = None
    try:
        directory = os.path.dirname(STATE_FILE_PATH) or '.'
        with tempfile.NamedTemporaryFile(
            'w',
            dir=directory,
            delete=False,
            encoding='utf-8'
        ) as state_file:
            temporary_path = state_file.name
            json.dump(state, state_file)
            state_file.flush()
            os.fsync(state_file.fileno())
        os.replace(temporary_path, STATE_FILE_PATH)
        return True
    except (OSError, TypeError, ValueError):
        logger.exception("Could not publish YOLO IPC state to %s.", STATE_FILE_PATH)
        if temporary_path and os.path.exists(temporary_path):
            try:
                os.unlink(temporary_path)
            except OSError:
                logger.exception("Could not remove temporary YOLO IPC file %s.", temporary_path)
        return False


def export_detection(
    raw_class: str,
    confidence: float,
    inference_ms: Optional[float] = None,
    camera_status: str = 'CONNECTED',
    box: Optional[list] = None
) -> bool:
    """Compatibility helper that publishes only the current IPC schema."""
    del inference_ms, box
    detection = {
        'class': raw_class,
        'confidence': confidence,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    return publish_yolo_state(detection, camera=camera_status)


def read_yolo_state() -> Dict[str, Any]:
    """Read and validate the producer's state without touching camera or inference."""
    try:
        with open(STATE_FILE_PATH, 'r', encoding='utf-8') as state_file:
            data = json.load(state_file)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return _unavailable_state()

    allowed_keys = {'status', 'camera', 'updatedAtEpoch', 'detection'}
    if not isinstance(data, dict):
        return _unavailable_state()
    keys = set(data)
    if keys != allowed_keys and keys != (allowed_keys | {'sensors'}):
        return _unavailable_state()

    updated_epoch = data['updatedAtEpoch']
    if isinstance(updated_epoch, bool) or not isinstance(updated_epoch, (int, float)) \
            or not math.isfinite(updated_epoch):
        return _unavailable_state()

    now = time.time()
    if updated_epoch > now or now - updated_epoch > STALE_TIMEOUT_SEC:
        return _unavailable_state()

    if data['status'] == 'STOPPED' and data['camera'] == 'DISCONNECTED' \
            and data['detection'] is None:
        return _unavailable_state()
    if data['status'] != 'RUNNING' or data['camera'] != 'CONNECTED':
        return _unavailable_state()

    detection = data['detection']
    if not _valid_detection(detection):
        return _unavailable_state()

    if detection is not None:
        parsed_timestamp = datetime.fromisoformat(
            detection['timestamp'].replace('Z', '+00:00')
        )
        if parsed_timestamp > datetime.now(timezone.utc):
            return _unavailable_state()

    validated_sensors = None
    if 'sensors' in data and isinstance(data['sensors'], dict):
        validated_sensors = {}
        for key in ('hc1', 'hc2', 'hc3'):
            entry = data['sensors'].get(key)
            if isinstance(entry, dict):
                fill = entry.get('fillPercent')
                norm_fill = normalize_fill_level(fill)
                epoch = entry.get('updatedAtEpoch')
                if (
                    norm_fill is not None
                    and isinstance(epoch, (int, float))
                    and not isinstance(epoch, bool)
                    and math.isfinite(epoch)
                    and epoch <= now
                    and 0 <= (now - epoch) <= HC_VALID_TIMEOUT_SEC
                ):
                    validated_sensors[key] = {
                        'fillPercent': norm_fill,
                        'updatedAtEpoch': float(epoch)
                    }
                else:
                    validated_sensors[key] = None
            else:
                validated_sensors[key] = None

    return {
        'yoloStatus': 'RUNNING',
        'cameraStatus': 'CONNECTED',
        'latestDetection': None if detection is None else {
            'class': detection['class'],
            'confidence': float(detection['confidence']),
            'timestamp': detection['timestamp']
        },
        'sensors': validated_sensors
    }


def _unavailable_state() -> Dict[str, Any]:
    return {
        'yoloStatus': 'STOPPED',
        'cameraStatus': 'DISCONNECTED',
        'latestDetection': None,
        'sensors': None
    }
