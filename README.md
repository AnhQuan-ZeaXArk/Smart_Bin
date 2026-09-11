# SmartBin Management System

SmartBin Management System is a role-aware waste management dashboard for a single SmartBin system with three compartments: organic, recyclable, and non-recyclable waste.

## Architecture

This project follows a simple three-layer deployment architecture:

- Frontend: Vite + React + TypeScript
- Backend API: Express + TypeScript + JWT + Prisma
- Database: PostgreSQL for Render deployment (production-ready model)

The web app communicates with the backend via API base URL from environment variables. The backend accepts requests from the production frontend domain through CORS configuration using environment variables.

## Technology stack

- Web: React, Vite, TypeScript, React Router
- API: Node.js, Express, TypeScript, JWT, bcrypt, Zod
- Database: PostgreSQL + Prisma
- Realtime: Socket.IO-ready and MQTT-ready for future device integration

## Folder structure

```text
apps/web       React frontend
apps/api      Express API and Prisma schema
README.md      Setup and deployment guide
.env.example  Shared env template
```

## Local development setup

Requirements: Node.js 20+ and npm 10+.

```powershell
npm install
Copy-Item .env.example .env
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Important:
- Use a strong `JWT_SECRET` in the environment.
- The app expects `DATABASE_URL` to be set for Prisma.
- Frontend uses `VITE_API_URL` and must not point to `localhost` in production.

## Environment variables

Core variables:

```env
NODE_ENV=development
PORT=4000
API_PORT=4000
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173
WEB_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/smartbin
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=1d
```

For Render production, set these values to the real Render URLs and database credentials.

## Demo accounts

The seed creates the default roles and demo accounts:

- admin
- supervisor
- worker

Passwords are controlled via environment variables such as:

```env
SEED_ADMIN_PASSWORD=...
SEED_SUPERVISOR_PASSWORD=...
SEED_WORKER_PASSWORD=...
```

## Database

Prisma uses PostgreSQL in the production-ready configuration. The schema includes the core SmartBin models:

- Role
- User
- Employee
- NfcCard
- Bin
- SensorReading
- AccessLog
- CollectionRecord
- Alert

The system is designed around one SmartBin with three waste compartments:

- Rác hữu cơ
- Rác tái chế
- Rác không tái chế

## Prisma commands

```powershell
npm run db:generate
npm run db:migrate
npm run db:seed
```

## Build and verification

```powershell
npm run lint
npm run build
```

## Render deployment plan

### Frontend service
- Build command: `npm install && npm run build --workspace @smartbin/web`
- Start command: `npm run preview --workspace @smartbin/web -- --host 0.0.0.0 --port $PORT`
- Env: `VITE_API_URL=https://<backend-render-url>`

### Backend service
- Build command: `npm install && npm run build --workspace @smartbin/api`
- Start command: `npm run start --workspace @smartbin/api`
- Env: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGIN`

### PostgreSQL database
- Create a PostgreSQL instance in Render.
- Set `DATABASE_URL` to the Render PostgreSQL connection string.
- Run Prisma migration before starting the API on production.

## CORS and API base URL

The backend reads `FRONTEND_URL` and `CORS_ORIGIN` from environment variables and applies the correct CORS policy.

The frontend reads `VITE_API_URL` from environment variables instead of using `localhost` in production.

## Health check

The backend exposes:

```http
GET /health
```

Example response:

```json
{ "status": "ok", "service": "smartbin-api" }
```

## Future integration

The current version is a demo-ready deployment milestone. It preserves the architecture needed for future IoT integration:

- ESP32 sensor input
- Raspberry Pi 5 upstream processing
- MQTT integration
- Socket.IO realtime updates
- backend telemetry ingestion

This milestone does not implement the physical IoT layer yet, but the API and frontend are structured to support it cleanly.

## Security notes

- Passwords are hashed before storage.
- JWT is required for protected endpoints.
- Private configuration such as secrets and credentials are excluded from GitHub.
- `.env` must never be committed to version control.

## Deployment checklist

- [ ] GitHub repository clean
- [ ] `.env` excluded from Git
- [ ] `.env.example` updated
- [ ] PostgreSQL ready in Render
- [ ] Prisma migration prepared
- [ ] Backend Render service configured
- [ ] Frontend Render service configured
- [ ] `VITE_API_URL` set correctly
- [ ] `CORS_ORIGIN` set correctly
- [ ] Health check working
- [ ] Login and RBAC tested
- [ ] Production build passing
