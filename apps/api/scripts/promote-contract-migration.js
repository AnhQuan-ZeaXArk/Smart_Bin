import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(apiDir, 'prisma', 'migrations');
const stagedContractDir = path.join(apiDir, 'prisma', 'staged_contract');

const source = path.join(stagedContractDir, '000000000004_multi_station_contract');
const target = path.join(migrationsDir, '000000000004_multi_station_contract');

if (!fs.existsSync(source)) {
  console.error('❌ Source staged contract migration does not exist:', source);
  process.exit(1);
}

if (fs.existsSync(target)) {
  console.log('ℹ️ Migration 04 is already in prisma/migrations/');
  process.exit(0);
}

fs.cpSync(source, target, { recursive: true });
console.log('✅ Promoted 000000000004_multi_station_contract into active prisma/migrations/ directory.');
console.log('   Release 2 (Contract Phase) is now ready to deploy via "npm run db:migrate:deploy".');

