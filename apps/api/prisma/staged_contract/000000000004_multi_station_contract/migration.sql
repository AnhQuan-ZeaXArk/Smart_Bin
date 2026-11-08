-- Migration 000000000004_multi_station_contract (Phase 5 Contract Phase)
-- Description: Finalize DB contract by making stationId NOT NULL and enforcing compound uniqueness (stationId, binCode).

-- ==============================================================================
-- STEP 1: EXECUTE CONCURRENT INDEX BUILD (OUTSIDE TRANSACTION / AUTOCOMMIT)
-- Run this statement independently in psql/CLI:
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Bin_stationId_binCode_key" ON "public"."Bin" ("stationId", "binCode");
-- ==============================================================================

-- ==============================================================================
-- STEP 2: VERIFICATION (DO BLOCK)
-- Ensure index is valid before altering constraints
-- ==============================================================================
DO $$
DECLARE
    v_is_valid BOOLEAN;
BEGIN
    SELECT indisvalid INTO v_is_valid 
    FROM pg_index 
    WHERE indexrelid = 'public."Bin_stationId_binCode_key"'::regclass;
    
    IF v_is_valid IS NOT TRUE THEN
        RAISE EXCEPTION 'CRITICAL: Index Bin_stationId_binCode_key is INVALID! Aborting contract migration.';
    END IF;
EXCEPTION
    WHEN undefined_table THEN
        -- If running in a mock/test runner without concurrent pre-step, create standard index in tx
        CREATE UNIQUE INDEX IF NOT EXISTS "Bin_stationId_binCode_key" ON "public"."Bin" ("stationId", "binCode");
END $$;

-- ==============================================================================
-- STEP 3: ATOMIC METADATA CUTOVER (RUN INSIDE TRANSACTION)
-- ==============================================================================
BEGIN;

-- Drop obsolete global unique index
DROP INDEX IF EXISTS "public"."Bin_binCode_key";

-- Enforce NOT NULL on stationId
ALTER TABLE "public"."Bin" ALTER COLUMN "stationId" SET NOT NULL;

-- Record migration provenance
INSERT INTO "public"."_migration_provenance" ("phase", "action", "target", "status", "notes")
VALUES ('PHASE_5', 'CONTRACT_SCHEMA', 'Bin.stationId NOT NULL, Bin_stationId_binCode_key', 'APPLIED', 'Finalized multi-station DB contract');

COMMIT;

