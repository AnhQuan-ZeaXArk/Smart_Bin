import { execSync } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..');

// Load .env if present
const envPath = path.join(apiDir, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const databaseUrl = process.env.DATABASE_URL || '';
const isPostgres = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://');

console.log('[db:validate] Validating schemas...');

// 1. Validate SQLite schema
console.log('[db:validate] 1. Validating SQLite schema (prisma/schema.sqlite.prisma)...');
execSync('npx prisma validate --schema=prisma/schema.sqlite.prisma', {
  cwd: apiDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl.startsWith('file:') ? databaseUrl : 'file:./prisma/dev.db'
  }
});

// 2. Validate PostgreSQL schema
console.log('[db:validate] 2. Validating PostgreSQL schema (prisma/schema.prisma)...');
execSync('npx prisma validate --schema=prisma/schema.prisma', {
  cwd: apiDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: isPostgres ? databaseUrl : 'postgresql://postgres:postgres@localhost:5432/smartbin'
  }
});

console.log('[db:validate] All Prisma schemas validated successfully! 🚀');
