import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { isDatabaseReady } from './lib/prisma.js';
import authRoutes from './routes/auth.routes.js';
import protectedRoutes from './routes/protected.routes.js';
import binRoutes from './routes/bin.routes.js';
import deviceRoutes from './routes/device.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import demoRoutes from './routes/demo.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import stationRoutes from './routes/station.routes.js';

export const app = express();
app.set('trust proxy', 1);
app.use(helmet());

const allowedOrigins = new Set(env.CORS_ORIGINS.map((o) => o.replace(/\/+$/, '')));

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const cleanOrigin = origin.trim().replace(/\/+$/, '');
    if (
      allowedOrigins.has(cleanOrigin) ||
      cleanOrigin.endsWith('.onrender.com') ||
      cleanOrigin.includes('localhost') ||
      cleanOrigin.includes('127.0.0.1')
    ) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

app.use(express.json());

// Liveness Endpoint (Render Health Check & Process Monitoring)
app.get('/health', (_request, response) => {
  const ready = isDatabaseReady();
  return response.status(200).json({
    status: 'ok',
    service: 'smartbin-api',
    mode: env.isDemoMode ? 'demo' : 'production',
    database: env.isDemoMode ? 'not_applicable' : (ready ? 'connected' : 'connecting'),
    ready
  });
});

// Readiness Endpoint (Traffic Dispatch & Database Verification Probe)
app.get('/health/ready', (_request, response) => {
  const ready = isDatabaseReady();
  if (!ready) {
    return response.status(503).json({
      ready: false,
      service: 'smartbin-api',
      mode: env.isDemoMode ? 'demo' : 'production',
      database: 'connecting',
      message: 'Database connection is in progress or not verified'
    });
  }
  return response.status(200).json({
    ready: true,
    service: 'smartbin-api',
    mode: env.isDemoMode ? 'demo' : 'production',
    database: env.isDemoMode ? 'not_applicable' : 'connected'
  });
});

app.use('/api/demo', demoRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/bins', binRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api', protectedRoutes);
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  return response.status(400).json({ message: 'Request could not be processed' });
});