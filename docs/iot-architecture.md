# IoT Communication Architecture

## Runtime flow

```text
ESP32 sensors/NFC -> Raspberry Pi 5 gateway -> MQTT broker -> SmartBin API -> Prisma/SQLite
                                                                        -> future Socket.IO -> Web app
```

The backend owns telemetry validation, Bin updates, and NFC ALLOWED/DENIED decisions. The browser never subscribes to MQTT directly. The Raspberry Pi gateway forwards device messages and does not own NFC authorization business rules.

## MQTT environment

```text
MQTT_BROKER_URL
MQTT_USERNAME
MQTT_PASSWORD
MQTT_CLIENT_ID
```

`MQTT_BROKER_URL` is optional in development. When it is absent, the API remains available and logs that MQTT is disabled. Credentials are never stored in source code.

## Topic contract

| Topic | Direction | Publisher | Subscriber | Purpose |
|---|---|---|---|---|
| `smartbin/{binCode}/telemetry` | device -> backend | gateway | backend | Generic telemetry |
| `smartbin/{binCode}/sensor/ultrasonic` | device -> backend | gateway | backend | Ultrasonic fill data |
| `smartbin/{binCode}/nfc/scan` | device -> backend | gateway | backend | NFC UID scan |
| `smartbin/{binCode}/nfc/result` | backend -> device | backend | gateway | ALLOWED/DENIED result |
| `smartbin/{binCode}/lock/command` | backend -> device | backend | gateway | OPEN/CLOSE command contract |
| `smartbin/{binCode}/lock/status` | device -> backend | gateway | backend | Lock state contract |
| `smartbin/{binCode}/status` | device -> backend | gateway | backend | ONLINE/OFFLINE/MAINTENANCE status |

## Ultrasonic telemetry

```json
{
  "binCode": "configured-bin-code",
  "distanceCm": 18.5,
  "fillLevel": 82,
  "timestamp": "2026-09-08T12:30:00.000Z",
  "deviceId": "gateway-optional"
}
```

The backend validates non-negative distance, fill level from 0 to 100, ISO timestamp, and an existing active Bin. Accepted messages create `SensorReading`, update `Bin.currentFillLevel`, set `lastSeen` to the message timestamp, and set status to `ONLINE`. Older messages are rejected and cannot overwrite newer telemetry.

## NFC scan and result

Scan payload:

```json
{
  "binCode": "configured-bin-code",
  "uid": "04:A1:B2:C3:D4:02",
  "timestamp": "2026-09-08T12:35:00.000Z",
  "deviceId": "gateway-optional"
}
```

The backend calls the existing `authenticateNfcUid` service. It then publishes:

```json
{
  "result": "ALLOWED",
  "reason": "VALID_CARD",
  "action": "AUTHENTICATE",
  "uid": "04:A1:B2:C3:D4:02",
  "timestamp": "2026-09-08T12:35:00.000Z"
}
```

The service records `AccessLog`; the MQTT layer does not duplicate that decision logic.

## Lock command

The adapter exposes a publish contract for:

```json
{
  "action": "OPEN",
  "requestId": "request-id",
  "timestamp": "2026-09-08T12:35:00.000Z"
}
```

No GPIO, servo, voltage, wiring, or module-specific assumptions are implemented.

## Resilience and limitations

- MQTT reconnects every five seconds after disconnect.
- MQTT errors are logged and do not stop the HTTP server.
- Invalid JSON, invalid topics, schema violations, unknown bins, and old telemetry are rejected.
- There is no offline scheduler yet; `OFFLINE` detection remains a later service.
- No Device table is introduced. `binCode` routes messages, while optional `deviceId` remains payload metadata until device lifecycle management is needed.
- Run `npm run mqtt:simulator` only with a development broker, `MQTT_BROKER_URL`, and `SIM_BIN_CODE` configured.
