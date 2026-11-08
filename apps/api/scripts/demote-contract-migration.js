import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(apiDir, 'prisma', 'migrations');
const stagedContractDir = path.join(apiDir, 'prisma', 'staged_contract');

const activeDir = path.join(migrationsDir, '000000000004_multi_station_contract');
const stagedDir = path.join(stagedContractDir, '000000000004_multi_station_contract');

if (fs.existsSync(activeDir)) {
  if (!fs.existsSync(stagedDir)) {
    fs.cpSync(activeDir, stagedDir, { recursive: true });
  }
  fs.rmSync(activeDir, { recursive: true, force: true });
  console.log('✅ Demoted Migration 04 from active prisma/migrations/ to prisma/staged_contract/.');
  console.log('   Release 1 (Expand-Only) packaging restored.');
} else {
  console.log('ℹ️ Migration 04 is already demoted (not present in prisma/migrations/).');
}

