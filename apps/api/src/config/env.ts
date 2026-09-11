import 'dotenv/config';
import { z } from 'zod';

const rawOrigins = [
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  process.env.WEB_ORIGIN
].flatMap((value) => value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGIN: z.string().optional(),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('1d'),
  MQTT_BROKER_URL: z.string().url().optional(),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_CLIENT_ID: z.string().min(1).default('smartbin-backend'),
  SIM_BIN_CODE: z.string().min(1).optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('change-me-admin'),
  SEED_SUPERVISOR_PASSWORD: z.string().min(8).default('change-me-supervisor'),
  SEED_WORKER_PASSWORD: z.string().min(8).default('change-me-worker')
});

export const env = {
  ...envSchema.parse(process.env),
  CORS_ORIGINS: [...new Set(rawOrigins)]
};