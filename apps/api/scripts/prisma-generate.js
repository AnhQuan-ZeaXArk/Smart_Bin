import { execSync } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..');

// Load .env if present (local development)
const envPath = path.join(apiDir, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Fallback dummy URL so prisma generate succeeds on Render without database configured
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://demo:demo@localhost:5432/smartbin_demo';
}

const databaseUrl = process.env.DATABASE_URL || '';
const isRender = Boolean(process.env.RENDER);
const isProduction = process.env.NODE_ENV === 'production';
const isExplicitSqlite = databaseUrl.startsWith('file:') || databaseUrl.startsWith('sqlite:');

// Production / Render ALWAYS uses PostgreSQL schema.prisma
// SQLite schema.sqlite.prisma is ONLY used in local non-production when DATABASE_URL is file: / sqlite:
const useSqlite = !isRender && !isProduction && isExplicitSqlite;
const schemaFile = useSqlite ? 'prisma/schema.sqlite.prisma' : 'prisma/schema.prisma';

console.log(`[db:generate] Environment: Render=${isRender}, Production=${isProduction}, DB=${databaseUrl.split(':')[0] || 'default'} -> schema: ${schemaFile}`);

// Resolve Prisma CLI from hoisted workspace or local node_modules
const prismaCli = [
  path.resolve(apiDir, '../../node_modules/prisma/build/index.js'),
  path.resolve(apiDir, 'node_modules/prisma/build/index.js')
].find(p => fs.existsSync(p));

const command = prismaCli
  ? `node "${prismaCli}" generate --schema=${schemaFile}`
  : `npx prisma generate --schema=${schemaFile}`;

try {
  execSync(command, {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env
  });
} catch (error) {
  process.exit(error.status || 1);
}
