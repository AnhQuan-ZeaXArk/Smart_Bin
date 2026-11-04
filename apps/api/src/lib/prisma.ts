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

export async function verifyDatabaseConnection(): Promise<void> {
  if (env.isDemoMode) {
    return;
  }

  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('[Prisma] Database connection established and verified successfully.');
  } catch (error) {
    console.error(
      '[Prisma FATAL] Could not connect to database in Production Mode:',
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}
