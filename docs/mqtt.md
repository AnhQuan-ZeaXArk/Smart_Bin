# MQTT

See [iot-architecture.md](iot-architecture.md) for the complete Milestone 5 topic and payload contract.

Planned topics:

- `smartbin/{binCode}/telemetry`
- `smartbin/{binCode}/sensor/ultrasonic`
- `smartbin/{binCode}/nfc/scan`
- `smartbin/{binCode}/nfc/result`
- `smartbin/{binCode}/lock/command`
- `smartbin/{binCode}/lock/status`
- `smartbin/{binCode}/status`

The device must make the local unlock decision. MQTT is for telemetry and access-event reporting, not for routing a browser request to a servo. The initial implementation will use a mock publisher before connecting Raspberry Pi hardware.

The backend NFC foundation is available as a service that normalizes a UID, checks card status and employee status, and returns `ALLOWED` or `DENIED` with a reason. The MQTT adapter calls that service and publishes the result. No hardware GPIO implementation is part of this milestone.
