-- Rollback Script for Migration 000000000004 (Phase 5 Contract Phase)
-- Golden Rule: Never use CASCADE, never delete from _migration_provenance.

-- ==============================================================================
-- STEP 1: RESTORE GLOBAL UNIQUE INDEX CONCURRENTLY (OUTSIDE TRANSACTION)
-- Run this statement independently in psql/CLI:
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Bin_binCode_key" ON "public"."Bin" ("binCode");
-- ==============================================================================

-- ==============================================================================
-- STEP 2: VERIFICATION (DO BLOCK)
-- ==============================================================================
DO $$
DECLARE
    v_is_valid BOOLEAN;
BEGIN
    SELECT indisvalid INTO v_is_valid 
    FROM pg_index 
    WHERE indexrelid = 'public."Bin_binCode_key"'::regclass;
    
    IF v_is_valid IS NOT TRUE THEN
        RAISE EXCEPTION 'Rollback failed: Index Bin_binCode_key is INVALID!';
    END IF;
EXCEPTION
    WHEN undefined_table THEN
        CREATE UNIQUE INDEX IF NOT EXISTS "Bin_binCode_key" ON "public"."Bin" ("binCode");
END $$;

-- ==============================================================================
-- STEP 3: ATOMIC ROLLBACK (RUN INSIDE TRANSACTION)
-- ==============================================================================
BEGIN;

-- Relax NOT NULL constraint
ALTER TABLE "public"."Bin" ALTER COLUMN "stationId" DROP NOT NULL;

-- Drop compound unique index
DROP INDEX IF EXISTS "public"."Bin_stationId_binCode_key";

-- Update provenance
UPDATE "public"."_migration_provenance"
SET "status" = 'ROLLED_BACK', "rolled_back_at" = CURRENT_TIMESTAMP, "notes" = 'Rollback Phase 5 Contract Schema'
WHERE "phase" = 'PHASE_5' AND "status" = 'APPLIED';

COMMIT;

