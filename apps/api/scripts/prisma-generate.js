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
const schemaFile = isPostgres ? 'prisma/schema.prisma' : 'prisma/schema.sqlite.prisma';

console.log(`[db:generate] Detected provider: ${isPostgres ? 'PostgreSQL' : 'SQLite'} -> schema: ${schemaFile}`);

try {
  execSync(`npx prisma generate --schema=${schemaFile}`, {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env
  });
} catch (error) {
  process.exit(error.status || 1);
}
