-- ==============================================================================
-- SMARTBIN MULTI-STATION: CONTROLLED ROLLBACK SCRIPT (ROUND 20.3)
-- Target Database: PostgreSQL (Production Render: smartbin_ppmz)
-- Scope:
--   1. Safely remove Station B and only the 3 bins created by the repair.
--   2. Revert stationId of Station A's 3 legacy bins back to NULL.
--   3. Restore global unique index Bin_binCode_key.
--   4. Record rollback provenance in _migration_provenance.
-- Safety:
--   - Single atomic transaction (BEGIN ... COMMIT).
--   - Does NOT delete Station A.
--   - Does NOT delete any pre-existing legacy bins or historical SensorReading.
--   - Post-checks ensure state exactly matches pre-repair baseline (1 Station, 3 Bins).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- BƯỚC 1: XÓA ĐÚNG 3 THÙNG RÁC CỦA TRẠM B (THEO ID CHÍNH XÁC)
-- Tuyệt đối không xóa bất kỳ thùng rác nào của Trạm A
-- ------------------------------------------------------------------------------
DELETE FROM "public"."Bin" 
WHERE "id" IN (
    'bin_station_b_recyclable_id',
    'bin_station_b_non_recyclable_id',
    'bin_station_b_organic_id'
);

-- ------------------------------------------------------------------------------
-- BƯỚC 2: XÓA BẢN GHI TRẠM B
-- ------------------------------------------------------------------------------
DELETE FROM "public"."Station" 
WHERE "id" = 'station_b_canonical_id' AND "code" = 'STATION_B';

-- ------------------------------------------------------------------------------
-- BƯỚC 3: HOÀN NGUYÊN stationId CỦA 3 THÙNG RÁC DI SẢN VỀ NULL
-- Bảo toàn 100% dữ liệu mức đầy, dung tích và lịch sử cảm biến
-- ------------------------------------------------------------------------------
UPDATE "public"."Bin"
SET "stationId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "binCode" IN ('ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE')
  AND "stationId" = 'station_a_canonical_id';

-- ------------------------------------------------------------------------------
-- BƯỚC 4: HOÀN NGUYÊN CHỈ MỤC DUY NHẤT TOÀN CỤC Bin_binCode_key
-- ------------------------------------------------------------------------------
DROP INDEX IF EXISTS "public"."Bin_stationId_binCode_key";
DROP INDEX IF EXISTS "public"."Bin_binCode_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "Bin_binCode_key" 
ON "public"."Bin" ("binCode");

-- ------------------------------------------------------------------------------
-- BƯỚC 5: GHI VẾT HOÀN NGUYÊN VÀO BẢNG _migration_provenance
-- ------------------------------------------------------------------------------
INSERT INTO "public"."_migration_provenance" (
    "phase", 
    "action", 
    "target", 
    "status", 
    "notes"
)
VALUES (
    'PHASE_3',
    'ROLLBACK_DATA_REPAIR',
    'Station A & B Bins',
    'APPLIED',
    'Round 20.3 rollback: Reverted stationId to NULL, removed Station B and its 3 bins, restored global Bin_binCode_key index.'
);

-- ==============================================================================
-- BƯỚC 6: POST-ROLLBACK CHECKS (XÁC MINH TRẠNG THÁI BASELINE)
-- ==============================================================================
DO $$
DECLARE
    v_stations_count INTEGER;
    v_station_b_exists INTEGER;
    v_bins_count INTEGER;
    v_null_bins_count INTEGER;
BEGIN
    -- 6.1. Chỉ còn lại đúng 1 trạm (Station A)
    SELECT count(*) INTO v_stations_count FROM "public"."Station";
    IF v_stations_count != 1 THEN
        RAISE EXCEPTION 'ROLLBACK POST-CHECK FAILED: Expected exactly 1 station, found %!', v_stations_count;
    END IF;

    -- 6.2. Trạm B không còn tồn tại
    SELECT count(*) INTO v_station_b_exists FROM "public"."Station" WHERE "code" = 'STATION_B';
    IF v_station_b_exists > 0 THEN
        RAISE EXCEPTION 'ROLLBACK POST-CHECK FAILED: Station B still exists in database!';
    END IF;

    -- 6.3. Tổng số thùng rác đúng bằng 3
    SELECT count(*) INTO v_bins_count FROM "public"."Bin";
    IF v_bins_count != 3 THEN
        RAISE EXCEPTION 'ROLLBACK POST-CHECK FAILED: Expected 3 bins, found %!', v_bins_count;
    END IF;

    -- 6.4. Cả 3 thùng rác đều có stationId IS NULL
    SELECT count(*) INTO v_null_bins_count FROM "public"."Bin" WHERE "stationId" IS NULL;
    IF v_null_bins_count != 3 THEN
        RAISE EXCEPTION 'ROLLBACK POST-CHECK FAILED: Expected all 3 bins to have stationId IS NULL, found %!', v_null_bins_count;
    END IF;

    RAISE NOTICE 'ROLLBACK POST-CHECKS PASSED: Database restored to exact pre-repair state.';
END $$;

COMMIT;
-- ==============================================================================
-- END OF SCRIPT: round20_3_multi_station_repair_rollback.sql
-- ==============================================================================

