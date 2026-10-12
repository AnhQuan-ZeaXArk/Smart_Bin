import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

function createPrismaClient(): PrismaClient {
  if (env.isDemoMode) {
    return new Proxy({}, {
      get: (_target, prop) => {
        if (prop === '$connect' || prop === '$disconnect') {
          return async () => {};
        }
        return new Proxy({}, {
          get: () => async () => null
        });
      }
    }) as unknown as PrismaClient;
  }
  return new PrismaClient();
}

export const prisma = createPrismaClient();