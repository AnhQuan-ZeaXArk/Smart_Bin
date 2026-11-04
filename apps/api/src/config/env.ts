import 'dotenv/config';
import { z } from 'zod';

const defaultOrigins = [
  'https://smartbin-web.onrender.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4000',
  'http://127.0.0.1:5173'
];

const userOrigins = [
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  process.env.WEB_ORIGIN
].flatMap((value) => value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []);

const rawOrigins = [...defaultOrigins, ...userOrigins].map((origin) => origin.replace(/\/+$/, ''));

export const DEMO_JWT_SECRET_DEFAULT = 'smartbin-demo-jwt-secret-placeholder-min16chars';

export function resolveDemoMode(): boolean {
  const rawDemoMode = process.env.DEMO_MODE;

  // 1. Nếu DEMO_MODE được thiết lập rõ ràng
  if (rawDemoMode !== undefined && rawDemoMode.trim() !== '') {
    const normalized = rawDemoMode.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
    throw new Error(
      `[CONFIG ERROR] Giá trị DEMO_MODE="${rawDemoMode}" không hợp lệ. Chỉ chấp nhận 'true', 'false', '1', hoặc '0'.`
    );
  }

  // 2. Nếu không khai báo DEMO_MODE:
  const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
  if (nodeEnv === 'production') {
    // NODE_ENV=production: mặc định Production
    return false;
  }

  // NODE_ENV=development hoặc test: tiếp tục hỗ trợ Demo mặc định khi chưa cấu hình Database
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '');
  if (!hasDatabaseUrl) {
    return true;
  }

  return false;
}

const computedDemoMode = resolveDemoMode();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default('https://smartbin-web.onrender.com'),
  CORS_ORIGIN: z.string().optional(),
  WEB_ORIGIN: z.string().url().default('https://smartbin-web.onrender.com'),
  DEMO_MODE: z.boolean().default(computedDemoMode),
  DATABASE_URL: computedDemoMode
    ? z.string().optional().default('')
    : z.string({ message: 'DATABASE_URL is required in Production Mode' })
      .trim()
      .min(1, 'DATABASE_URL cannot be empty in Production Mode'),
  JWT_SECRET: computedDemoMode
    ? z.string().default(DEMO_JWT_SECRET_DEFAULT)
    : z.string({ message: 'JWT_SECRET is required in Production Mode' })
      .min(16, 'JWT_SECRET must be at least 16 characters in Production Mode')
      .refine(
        (secret) => secret.trim() !== DEMO_JWT_SECRET_DEFAULT,
        'JWT_SECRET cannot use the default Demo secret in Production Mode'
      ),
  JWT_EXPIRES_IN: z.string().default('1d'),
  MQTT_BROKER_URL: z.string().url().optional(),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_CLIENT_ID: z.string().min(1).default('smartbin-backend'),
  SIM_BIN_CODE: z.string().min(1).optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('change-me-admin'),
  SEED_SUPERVISOR_PASSWORD: z.string().min(8).default('change-me-supervisor'),
  SEED_WORKER_PASSWORD: z.string().min(8).default('change-me-worker'),
  DEVICE_INGEST_TOKEN: z.string().optional()
});

const rawDatabaseUrl = process.env.DATABASE_URL ? process.env.DATABASE_URL.trim() : undefined;

let parsedEnv: z.infer<typeof envSchema>;
try {
  parsedEnv = envSchema.parse({
    ...process.env,
    ...(rawDatabaseUrl !== undefined ? { DATABASE_URL: rawDatabaseUrl } : {}),
    DEMO_MODE: computedDemoMode,
    ...(computedDemoMode && !process.env.JWT_SECRET ? { JWT_SECRET: DEMO_JWT_SECRET_DEFAULT } : {})
  });
} catch (error) {
  if (error instanceof z.ZodError) {
    const errorMessages = error.issues
      .map((issue) => `  - [${issue.path.join('.') || 'env'}]: ${issue.message}`)
      .join('\n');
    console.error(`\n[FATAL] Environment Configuration Error (Mode: ${computedDemoMode ? 'DEMO' : 'PRODUCTION'}):\n${errorMessages}\n`);
  }
  throw error;
}

export const env = {
  ...parsedEnv,
  isDemoMode: parsedEnv.DEMO_MODE,
  CORS_ORIGINS: [...new Set(rawOrigins)]
};
export const isDemoMode = env.isDemoMode;
