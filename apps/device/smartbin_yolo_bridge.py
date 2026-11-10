#!/usr/bin/env python3
"""Atomic, read-only-from-Agent YOLO IPC contract."""

import json
import logging
import math
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

STATE_FILE_PATH = os.getenv('SMARTBIN_YOLO_STATE_FILE', '/tmp/smartbin_yolo_state.json')
BACKEND_ACK_FILE_PATH = os.getenv('SMARTBIN_BACKEND_ACK_FILE', '/tmp/smartbin_backend_ack.json')
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
VALID_COLLECTION_EVENT_TYPES = frozenset({'OPEN', 'CLOSE'})
VALID_COLLECTION_SOURCES = frozenset({'PHYSICAL_BUTTON'})
REQUIRED_COLLECTION_EVENT_KEYS = frozenset({
    'eventId',
    'sessionId',
    'stationId',
    'triggerSource',
    'eventType',
    'occurredAt'
})
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


def _sanitize_collection_event(event: Any) -> Optional[Dict[str, str]]:
    if not isinstance(event, dict):
        return None
    if not REQUIRED_COLLECTION_EVENT_KEYS.issubset(set(event)):
        return None
    event_id = event.get('eventId')
    session_id = event.get('sessionId')
    station_id = event.get('stationId')
    trigger_source = event.get('triggerSource')
    event_type = event.get('eventType')
    occurred_at = event.get('occurredAt')
    if (
        not isinstance(event_id, str) or not event_id.strip()
        or not isinstance(session_id, str) or not session_id.strip()
        or not isinstance(station_id, str) or not station_id.strip()
        or not isinstance(trigger_source, str) or trigger_source not in VALID_COLLECTION_SOURCES
        or not isinstance(event_type, str) or event_type not in VALID_COLLECTION_EVENT_TYPES
        or not _valid_timestamp(occurred_at)
    ):
        return None
    return {
        'eventId': event_id.strip(),
        'sessionId': session_id.strip(),
        'stationId': station_id.strip(),
        'triggerSource': trigger_source,
        'eventType': event_type,
        'occurredAt': occurred_at
    }


def _valid_collection_event(event: Any) -> bool:
    return _sanitize_collection_event(event) is not None


def publish_yolo_state(
    detection: Optional[Dict[str, Any]] = None,
    status: str = 'RUNNING',
    camera: str = 'CONNECTED',
    sensors: Optional[Dict[str, Any]] = None,
    collection_events: Optional[List[Dict[str, Any]]] = None,
    lid_alert: bool = False
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

    state: Dict[str, Any] = {
        'status': status,
        'camera': camera,
        'updatedAtEpoch': time.time(),
        'detection': None if detection is None else {
            'class': detection['class'],
            'confidence': float(detection['confidence']),
            'timestamp': detection['timestamp']
        }
    }
    if lid_alert:
        state['lidAlert'] = True
    sanitized_sensors = _sanitize_sensors_for_publish(sensors)
    if sanitized_sensors is not None:
        state['sensors'] = sanitized_sensors

    if collection_events is not None and isinstance(collection_events, list) and status == 'RUNNING':
        sanitized_events: List[Dict[str, str]] = []
        seen_ids = set()
        for ev in collection_events:
            sanitized_ev = _sanitize_collection_event(ev)
            if sanitized_ev is not None and sanitized_ev['eventId'] not in seen_ids:
                sanitized_events.append(sanitized_ev)
                seen_ids.add(sanitized_ev['eventId'])
        if sanitized_events:
            state['collectionEvents'] = sanitized_events

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


def _write_json_atomically(path: str, data: Dict[str, Any]) -> bool:
    """Atomic write to file via a temporary file in the same directory."""
    temporary_path = None
    try:
        directory = os.path.dirname(path) or '.'
        with tempfile.NamedTemporaryFile(
            'w',
            dir=directory,
            delete=False,
            encoding='utf-8'
        ) as tmp_file:
            temporary_path = tmp_file.name
            json.dump(data, tmp_file)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())
        os.replace(temporary_path, path)
        return True
    except (OSError, TypeError, ValueError):
        logger.exception("Could not atomically write JSON to %s.", path)
        if temporary_path and os.path.exists(temporary_path):
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
        return False


def _read_raw_backend_ack_file() -> Dict[str, Any]:
    """Read transient Backend ACK state from /tmp/smartbin_backend_ack.json."""
    if not os.path.exists(BACKEND_ACK_FILE_PATH):
        return {}
    try:
        with open(BACKEND_ACK_FILE_PATH, 'r', encoding='utf-8') as ack_file:
            content = json.load(ack_file)
            return content if isinstance(content, dict) else {}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def record_backend_ack(
    event_id: str,
    session_id: Optional[str] = None,
    event_type: Optional[str] = None
) -> bool:
    """
    Record that an event has been committed to PostgreSQL and confirmed by Backend via Socket.IO ACK.
    This writes atomically to /tmp/smartbin_backend_ack.json (transient tmpfs).
    This function must ONLY be called when Backend returns Socket.IO ACK with success=True.
    """
    if not isinstance(event_id, str) or not event_id.strip():
        return False
    event_id = event_id.strip()

    current_data = _read_raw_backend_ack_file()
    acked_events = current_data.get('ackedEvents', {})
    if not isinstance(acked_events, dict):
        acked_events = {}

    now_epoch = time.time()
    # Prune ACKs older than 3600 seconds to prevent unbounded growth in /tmp
    pruned_events = {
        eid: info for eid, info in acked_events.items()
        if isinstance(info, dict) and (now_epoch - info.get('ackedAtEpoch', 0)) < 3600.0
    }
    pruned_events[event_id] = {
        'sessionId': session_id.strip() if isinstance(session_id, str) else None,
        'eventType': event_type.strip() if isinstance(event_type, str) else None,
        'ackedAtEpoch': now_epoch
    }

    confirmed_sessions = set(current_data.get('confirmedOpenSessionIds', []))
    if not isinstance(confirmed_sessions, set):
        confirmed_sessions = set()
    if session_id and isinstance(session_id, str):
        cleaned_sess = session_id.strip()
        if event_type == 'OPEN':
            confirmed_sessions.add(cleaned_sess)
        elif event_type == 'CLOSE':
            confirmed_sessions.discard(cleaned_sess)

    payload = {
        'source': 'BACKEND_SOCKET_IO_ACK',
        'updatedAtEpoch': now_epoch,
        'ackedEvents': pruned_events,
        'confirmedOpenSessionIds': list(confirmed_sessions)
    }

    return _write_json_atomically(BACKEND_ACK_FILE_PATH, payload)


def record_dropped_offline_event(event_id: str) -> bool:
    """
    Record an event that was dropped due to offline status so it is never replayed after reconnect.
    """
    if not isinstance(event_id, str) or not event_id.strip():
        return False
    event_id = event_id.strip()

    current_data = _read_raw_backend_ack_file()
    acked_events = current_data.get('ackedEvents', {})
    if not isinstance(acked_events, dict):
        acked_events = {}
    now_epoch = time.time()
    acked_events[event_id] = {
        'sessionId': None,
        'eventType': 'DROPPED_OFFLINE',
        'ackedAtEpoch': now_epoch
    }
    payload = {
        'source': 'OFFLINE_DROPPED_EVENT',
        'updatedAtEpoch': now_epoch,
        'ackedEvents': acked_events,
        'confirmedOpenSessionIds': current_data.get('confirmedOpenSessionIds', [])
    }
    return _write_json_atomically(BACKEND_ACK_FILE_PATH, payload)


def get_acknowledged_backend_event_ids() -> set[str]:
    """Retrieve all event IDs confirmed by Backend ACK (or marked dropped offline)."""
    data = _read_raw_backend_ack_file()
    acked_events = data.get('ackedEvents', {})
    if isinstance(acked_events, dict):
        return set(acked_events.keys())
    return set()


def get_confirmed_backend_open_sessions() -> set[str]:
    """Retrieve active session IDs that have had their OPEN confirmed by Backend ACK."""
    data = _read_raw_backend_ack_file()
    sessions = data.get('confirmedOpenSessionIds', [])
    if isinstance(sessions, list):
        return set(sessions)
    return set()


def reset_backend_ack_state() -> None:
    """Helper for testing to reset the transient backend ack file."""
    if os.path.exists(BACKEND_ACK_FILE_PATH):
        try:
            os.unlink(BACKEND_ACK_FILE_PATH)
        except OSError:
            pass


def _extract_valid_collection_events(data: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    """
    Validate transient collection events from the live IPC snapshot.
    Events that have already received Backend ACK (or were dropped) are filtered out immediately.
    """
    acked_ids = get_acknowledged_backend_event_ids()
    events_by_id: Dict[str, Dict[str, str]] = {}
    if isinstance(data, dict) and 'collectionEvents' in data:
        raw_events = data.get('collectionEvents')
        if isinstance(raw_events, list):
            for raw_item in raw_events:
                sanitized = _sanitize_collection_event(raw_item)
                if sanitized is not None:
                    ev_id = sanitized['eventId']
                    if ev_id not in acked_ids and ev_id not in events_by_id:
                        events_by_id[ev_id] = sanitized
        elif raw_events is not None:
            logger.warning("Ignoring malformed collectionEvents field in YOLO IPC state.")
    return list(events_by_id.values())


def read_yolo_state() -> Dict[str, Any]:
    """Read and validate the producer's state without touching camera or inference."""
    try:
        with open(STATE_FILE_PATH, 'r', encoding='utf-8') as state_file:
            data = json.load(state_file)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return _unavailable_state()

    required_keys = {'status', 'camera', 'updatedAtEpoch', 'detection'}
    optional_keys = {'sensors', 'collectionEvents', 'lidAlert'}
    allowed_keys = required_keys | optional_keys
    if not isinstance(data, dict):
        return _unavailable_state()
    keys = set(data)
    if not required_keys.issubset(keys) or not keys.issubset(allowed_keys):
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
                raw_epoch = float(epoch) if isinstance(epoch, (int, float)) and not isinstance(epoch, bool) and math.isfinite(epoch) else None
                sec_epoch = (raw_epoch / 1000.0 if raw_epoch > 1e11 else raw_epoch) if raw_epoch is not None else None
                if (
                    norm_fill is not None
                    and sec_epoch is not None
                    and sec_epoch <= now
                    and 0 <= (now - sec_epoch) <= HC_VALID_TIMEOUT_SEC
                ):
                    validated_sensors[key] = {
                        'fillPercent': norm_fill,
                        'updatedAtEpoch': sec_epoch
                    }
                else:
                    validated_sensors[key] = None
            else:
                validated_sensors[key] = None

    validated_collection_events = _extract_valid_collection_events(data)

    return {
        'yoloStatus': 'RUNNING',
        'cameraStatus': 'CONNECTED',
        'latestDetection': None if detection is None else {
            'class': detection['class'],
            'confidence': float(detection['confidence']),
            'timestamp': detection['timestamp']
        },
        'sensors': validated_sensors,
        'collectionEvents': validated_collection_events,
        'lidAlert': bool(data.get('lidAlert', False))
    }


def _unavailable_state() -> Dict[str, Any]:
    return {
        'yoloStatus': 'STOPPED',
        'cameraStatus': 'DISCONNECTED',
        'latestDetection': None,
        'sensors': None,
        'collectionEvents': [],
        'lidAlert': False
    }
