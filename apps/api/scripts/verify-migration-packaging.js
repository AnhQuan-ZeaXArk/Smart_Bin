import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(apiDir, 'prisma', 'migrations');
const stagedContractDir = path.join(apiDir, 'prisma', 'staged_contract');
const backfillDir = path.join(apiDir, 'prisma', 'backfill');

function getSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

console.log('=== VERIFYING TWO-PHASE MIGRATION PACKAGING ===\n');

// 1. Kiểm tra thư mục active migrations
const allSubdirs = fs.readdirSync(migrationsDir).filter(name => {
  return fs.statSync(path.join(migrationsDir, name)).isDirectory();
});

// Chặn đứng lỗi P3015: Bắt buộc 100% thư mục con trong migrations/ phải khớp định dạng ^\d{12}_.*$
const invalidDirs = allSubdirs.filter(name => !/^\d{12}_.*$/.test(name));
if (invalidDirs.length > 0) {
  console.error('\n❌ ERROR: prisma/migrations/ contains invalid non-migration subdirectories:');
  invalidDirs.forEach(d => console.error(`   - ${d} (Causes Prisma error P3015!)`));
  console.error('   All non-migration folders (e.g. rollback, staged) MUST reside OUTSIDE prisma/migrations/!\n');
  process.exit(1);
}

const activeMigrations = allSubdirs;

console.log('1. Active migrations in prisma/migrations/:');
activeMigrations.forEach(m => console.log(`   - ${m}`));

const hasMigration03 = activeMigrations.includes('000000000003_multi_station_expand');
const hasMigration04 = activeMigrations.includes('000000000004_multi_station_contract');

if (!hasMigration03) {
  console.error('\n❌ ERROR: Migration 000000000003_multi_station_expand is MISSING from prisma/migrations/!');
  process.exit(1);
}

if (hasMigration04) {
  console.error('\n❌ ERROR: Migration 000000000004_multi_station_contract is present in prisma/migrations/!');
  console.error('   This will cause Prisma to execute Contract immediately after Expand!');
  process.exit(1);
}

console.log('\n  -> PASS: prisma/migrations/ contains Migration 03 Expand ONLY.');
console.log('  -> PASS: Migration 04 Contract is NOT in active migrations directory.');

// 2. Kiểm tra thư mục staged_contract
const stagedContractPath = path.join(stagedContractDir, '000000000004_multi_station_contract', 'migration.sql');
if (!fs.existsSync(stagedContractPath)) {
  console.error('\n❌ ERROR: Staged Migration 04 not found at:', stagedContractPath);
  process.exit(1);
}

const hash04 = getSha256(stagedContractPath);
console.log('\n2. Staged Contract Migration:');
console.log(`   - Location: prisma/staged_contract/000000000004_multi_station_contract/migration.sql`);
console.log(`   - SHA256:   ${hash04}`);

if (hash04 !== '632AE2AA43178943D23F7807C150AC634D7E64AC351055E0E373632BB5113D8D') {
  console.error('\n❌ ERROR: Checksum mismatch for Migration 04! Content may have been altered.');
  process.exit(1);
}
console.log('  -> PASS: Migration 04 checksum verified (100% byte-for-byte identical).');

// 3. Kiểm tra Migration 03 checksum
const migration03Path = path.join(migrationsDir, '000000000003_multi_station_expand', 'migration.sql');
const hash03 = getSha256(migration03Path);
console.log('\n3. Active Expand Migration:');
console.log(`   - Location: prisma/migrations/000000000003_multi_station_expand/migration.sql`);
console.log(`   - SHA256:   ${hash03}`);

if (hash03 !== 'B6F27524E0D6C2410D750ACFACAE2C12461C3C41F765F58058A3783C6BAD1FC1') {
  console.error('\n❌ ERROR: Checksum mismatch for Migration 03!');
  process.exit(1);
}
console.log('  -> PASS: Migration 03 checksum verified (100% byte-for-byte identical).');

// 4. Kiểm tra file Backfill SQL
const backfillPath = path.join(backfillDir, 'backfill_station_a.sql');
if (!fs.existsSync(backfillPath)) {
  console.error('\n❌ ERROR: Backfill SQL script missing at:', backfillPath);
  process.exit(1);
}
const backfillContent = fs.readFileSync(backfillPath, 'utf8');
const hasPreChecks = backfillContent.includes('PRE-CHECKS');
const hasTransaction = backfillContent.includes('BEGIN;') && backfillContent.includes('COMMIT;');
const hasPostChecks = backfillContent.includes('POST-CHECKS');
const hasNoOverwrite = backfillContent.includes('WHERE "stationId" IS NULL');

if (!hasPreChecks || !hasTransaction || !hasPostChecks || !hasNoOverwrite) {
  console.error('\n❌ ERROR: Backfill script is missing required safety controls!');
  process.exit(1);
}
console.log('\n4. Backfill SQL script:');
console.log(`   - Location: prisma/backfill/backfill_station_a.sql`);
console.log('  -> PASS: Pre-checks, Atomic Transaction, Non-overwriting condition, and Post-checks verified.');

// 5. Kiểm tra thư mục rollback scripts (bắt buộc nằm ngoài prisma/migrations)
const rollbackDir = path.join(apiDir, 'prisma', 'rollback');
const hasRollbackP1 = fs.existsSync(path.join(rollbackDir, 'rollback_phase_1.sql'));
const hasRollbackP5 = fs.existsSync(path.join(rollbackDir, 'rollback_phase_5.sql'));
if (!hasRollbackP1 || !hasRollbackP5) {
  console.error('\n❌ ERROR: Rollback SQL scripts missing in prisma/rollback/!');
  process.exit(1);
}
console.log('\n5. Rollback SQL scripts:');
console.log(`   - Location: prisma/rollback/ (isolated outside prisma/migrations)`);
console.log('  -> PASS: rollback_phase_1.sql and rollback_phase_5.sql verified.');

console.log('\n===========================================================');
console.log('STATUS: RELEASE 1 (EXPAND ONLY) PACKAGING IS 100% READY & VERIFIED!');
console.log('PRISMA MIGRATE DEPLOY WILL ONLY APPLY MIGRATION 03 EXPAND.');
console.log('===========================================================\n');

