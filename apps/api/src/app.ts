import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import protectedRoutes from './routes/protected.routes.js';
import binRoutes from './routes/bin.routes.js';
import deviceRoutes from './routes/device.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';

export const app = express();
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedOrigins = env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : [env.FRONTEND_URL, env.WEB_ORIGIN];
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'smartbin-api', mode: env.isDemoMode ? 'demo' : 'production' }));
app.use('/api/auth', authRoutes);
app.use('/api/bins', binRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api', protectedRoutes);
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  return response.status(400).json({ message: 'Request could not be processed' });
});