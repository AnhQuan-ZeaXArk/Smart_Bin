# Development

Milestone 1 establishes the monorepo, React and Express workspaces, Prisma SQLite schema, migration/seed workflow, JWT authentication structure, RBAC middleware, and documentation.

Next milestones should be implemented incrementally: authentication UI and protected routes, bin management, employees/NFC, sensor ingestion, MQTT and Socket.IO realtime updates, access logs, collections, alerts, then testing and polish.

Keep secrets in environment variables. Do not commit `.env` or generated SQLite files. Run `npm run lint` and `npm run build` before moving to the next milestone.
