# Architecture

SmartBin is one web application backed by one API and one database.

```text
ESP32 sensors/NFC -> Raspberry Pi device logic -> MQTT -> Express API -> Prisma/SQLite
                                                   -> Socket.IO -> React web app
```

The device decides whether an NFC UID may open the lock. The API receives the resulting access event and stores both successful and denied attempts. Sensor messages update the bin and sensor history. A future MQTT adapter will implement the same device message abstraction as the mock publisher.

The backend is organized as routes, middleware, services, and persistence. Milestone 1 establishes configuration, authentication, RBAC middleware, Prisma models, and seed data; later milestones add the domain services and realtime adapter.
