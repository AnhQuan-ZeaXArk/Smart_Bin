import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

function createPrismaClient(): PrismaClient {
  if (env.isDemoMode) {
    return new Proxy({} as any, {
      get: (target, prop) => {
        if (prop in target) {
          return (target as any)[prop];
        }
        if (prop === '$connect' || prop === '$disconnect') {
          return async () => {};
        }
        return new Proxy({}, {
          get: () => async () => null
        });
      }
    }) as unknown as PrismaClient;
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL
      }
    }
  });
}

export const prisma = createPrismaClient();

let databaseReady = false;

export function isDatabaseReady(): boolean {
  return env.isDemoMode || databaseReady;
}

export function setDatabaseReady(ready: boolean): void {
  databaseReady = ready;
}

export interface DatabaseVerifyOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export async function verifyDatabaseConnection(options: DatabaseVerifyOptions = {}): Promise<void> {
  if (env.isDemoMode) {
    setDatabaseReady(true);
    return;
  }

  const {
    timeoutMs = 15_000,
    maxRetries = 3,
    retryDelayMs = 2_000
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let isTimedOut = false;
    let timer: NodeJS.Timeout | null = null;

    try {
      console.log(`[Prisma] Verifying database connection (attempt ${attempt}/${maxRetries})...`);

      const connectPromise = (async () => {
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
      })().catch((err) => {
        if (isTimedOut) {
          // Ngăn unhandledRejection khi thao tác trước đó thất bại sau thời điểm timeout
          console.debug(`[Prisma DEBUG] Suppressed late rejection from timed-out attempt ${attempt}:`, err?.message || err);
          return;
        }
        throw err;
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          isTimedOut = true;
          reject(new Error(`Database verification attempt ${attempt}/${maxRetries} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref();
      });

      await Promise.race([connectPromise, timeoutPromise]);
      if (timer) clearTimeout(timer);

      setDatabaseReady(true);
      console.log('[Prisma] Database connection established and verified successfully.');
      return;
    } catch (error) {
      if (timer) clearTimeout(timer);
      setDatabaseReady(false);
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[Prisma WARNING] Connection attempt ${attempt}/${maxRetries} failed: ${errorMsg}`);

      // Giải phóng connection pool trước khi thử lại để tránh kết nối chồng lấn
      await prisma.$disconnect().catch(() => {});

      if (attempt < maxRetries) {
        console.log(`[Prisma] Retrying database connection in ${retryDelayMs}ms...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  setDatabaseReady(false);
  console.error(
    '[Prisma FATAL] Could not connect to database in Production Mode after all attempts:',
    lastError instanceof Error ? lastError.message : lastError
  );
  throw lastError;
}
