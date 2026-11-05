# SmartBin Pi Agent and YOLO IPC

The Agent reports Raspberry Pi status to the SmartBin Backend. It does not start
YOLO, open a camera, access ESP32 serial, generate sensor readings, or issue
hardware-control commands. Only `PING` is accepted; all other device commands
are rejected.

## Existing Raspberry Pi installation

Use the existing installation at `/home/pi/smartbin-agent/` and its existing
virtual environment. Do not create a second YOLO pipeline or virtual
environment. The existing YOLO program remains
`/home/pi/Desktop/yolo_camera.py`, running in `/home/pi/yolo-env-new/`; it must
be started and managed separately using its already-tested procedure.

The Agent needs Python 3.10+ and these runtime packages:

- `python-socketio[client]`
- `requests`
- `python-dotenv`

`requirements.txt` lists Agent dependencies only. Do not install an AI model,
OpenCV, or ESP32 serial package for this Agent stage.

## Environment

Keep `/home/pi/smartbin-agent/.env` private (mode `600`). It must contain the
real server URL and `DEVICE_INGEST_TOKEN`; never commit or print the token.
`DEVICE_ID` must remain `raspberry-pi-5`. The Agent uses:

```ini
SERVER_URL=https://smartbin-api-e08b.onrender.com
DEVICE_ID=raspberry-pi-5
DEVICE_INGEST_TOKEN=<configured device token>
TELEMETRY_INTERVAL=5
SMARTBIN_YOLO_STATE_FILE=/tmp/smartbin_yolo_state.json
```

## YOLO IPC status

The YOLO process publishes `/tmp/smartbin_yolo_state.json` atomically through
`publish_yolo_state()` in `smartbin_yolo_bridge.py`. The path can be overridden
with `SMARTBIN_YOLO_STATE_FILE`. Keep the same bridge module available to both
processes: the existing YOLO script must be able to import it, and the Agent
must use its copy in `/home/pi/smartbin-agent/`.

Each successful inference publishes `status`, `camera`, `updatedAtEpoch`, and
either `detection: null` or a detection containing the accepted class,
confidence, and timezone-aware UTC timestamp. Only `taiche`, `khongtaiche`, and
`huuco` are accepted. A frame without a valid object publishes `detection:
null`; an earlier frame's detection is not reused. YOLO publishes
STOPPED/DISCONNECTED when it exits. IPC write errors are logged and do not stop
inference or ESP32 handling.

The Agent rejects missing, malformed, invalid, stale, and future-dated state.
The reader's stale timeout defaults to **10 seconds** (configured with
`SMARTBIN_YOLO_STALE_TIMEOUT_SEC`); missing or invalid timeout configuration
also falls back to 10 seconds. An unavailable state contains no detection.
`metadata.lastInferenceMs` is not sent because this IPC schema does not contain
a real inference-duration value.

When deploying manually, make `smartbin_yolo_bridge.py` importable by the
existing YOLO script (for example, place the reviewed module beside
`yolo_camera.py`) and update the Agent's existing copy. Do not start a second
YOLO process or change its model, inference, serial protocol, or servo logic.
No physical Pi, camera, or ESP32 test is implied by the repository tests.

## Prepare and validate the Agent on the Pi

After manually copying the reviewed Agent files into the existing directory,
run these non-hardware checks:

```bash
cd /home/pi/smartbin-agent
chmod 600 .env
./venv/bin/python --version
./venv/bin/python -m py_compile pi_agent.py smartbin_yolo_bridge.py
./venv/bin/python -m unittest test_pi_agent_stage41 -v
```

On the development machine, the YOLO IPC lifecycle tests use mocks and do not
open a camera or serial port:

```bash
python -m unittest apps.device.test_yolo_ipc_integration -v
```

The Agent retries Socket.IO connections using exponential backoff capped at 60
seconds. It uses HTTP `POST /api/demo/device-heartbeat` with Bearer
authentication when Socket.IO is unavailable (or telemetry emit fails). The
token is not written to logs.

## Run manually

Only run after reviewing `.env` and confirming the endpoint/token:

```bash
cd /home/pi/smartbin-agent
./venv/bin/python pi_agent.py
```

Stop with `Ctrl+C`. This runs only the Agent; it does not start YOLO, access a
camera, or communicate with ESP32.

No systemd unit is installed or assumed by this repository. If adding a service,
verify the actual account, paths, environment-file permissions, and existing
service state first. Do not copy a service unit with guessed usernames or
virtual-environment paths.
