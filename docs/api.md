# API

Milestone 1 endpoints:

- `GET /health`
- `POST /api/auth/login`
- `GET /api/auth/me` with a Bearer token

Authentication uses bcrypt password hashes and JWT tokens. `requireAuth` validates the token and `requireRoles` provides the RBAC boundary for future routes.

Planned routes include `/api/bins`, `/api/employees`, `/api/nfc-cards`, `/api/access-logs`, `/api/sensor-readings`, `/api/collections`, `/api/alerts`, `/api/users`, and `/api/settings`.

Milestone 4 Employee/NFC routes:

- `GET /api/employees/:id`
- `POST /api/employees`
- `PUT /api/employees/:id`
- `DELETE /api/employees/:id` (deactivates the employee)
- `GET /api/nfc-cards`
- `GET /api/nfc-cards/:id`
- `POST /api/nfc-cards` (ADMIN)
- `PUT /api/nfc-cards/:id`
- `POST /api/nfc-cards/:id/assign`
- `POST /api/nfc-cards/:id/revoke`

Employee reads are available to all roles; employee writes are ADMIN/SUPERVISOR and deactivation is ADMIN-only. NFC card reads are available to all roles; card management is ADMIN/SUPERVISOR except issuing a new card, which is ADMIN-only.
