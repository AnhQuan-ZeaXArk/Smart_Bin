-- Rollback Script for Migration 000000000003 (Phase 1 Expand Phase)
-- Golden Rule: Never use CASCADE, never delete from _migration_provenance.

BEGIN;

-- 1. Remove foreign key
ALTER TABLE "public"."Bin" DROP CONSTRAINT IF EXISTS "Bin_stationId_fkey";

-- 2. Drop columns added in Phase 1
ALTER TABLE "public"."Bin" DROP COLUMN IF EXISTS "stationId";
ALTER TABLE "public"."Bin" DROP COLUMN IF EXISTS "installed";
ALTER TABLE "public"."SensorReading" DROP COLUMN IF EXISTS "isLate";

-- 3. Drop tables created in Phase 1
DROP TABLE IF EXISTS "public"."StationWatermark";
DROP TABLE IF EXISTS "public"."TelemetryIdempotencyLedger";
DROP TABLE IF EXISTS "public"."Station";

-- 4. Update provenance record (IMMUTABLE AUDIT TRAIL)
UPDATE "public"."_migration_provenance"
SET "status" = 'ROLLED_BACK', "rolled_back_at" = CURRENT_TIMESTAMP, "notes" = 'Rollback Phase 1 Expand Schema'
WHERE "phase" = 'PHASE_1' AND "status" = 'APPLIED';

COMMIT;

