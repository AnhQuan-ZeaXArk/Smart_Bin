-- ==============================================================================
-- SMARTBIN MULTI-STATION: CONTROLLED ROLLBACK SCRIPT (ROUND 20.7)
-- Target Database: PostgreSQL (Production Render: smartbin_ppmz)
-- Scope:
--   1. Safety validation: Strictly aborts if Station B has accumulated any operational data
--      (SensorReading, CollectionRecord, Alert). Does NOT automatically destroy production data.
--   2. Safely removes Station B and only its 3 empty baseline bins.
--   3. Reverts stationId of Station A's 3 legacy bins back to NULL without altering historical telemetry.
--   4. Restores global unique index Bin_binCode_key and verifies catalog definition.
--   5. Idempotently marks audit trail in _migration_provenance as ROLLED_BACK.
-- Safety & Invariants:
--   - Single atomic transaction: Pre-checks, DDL, DML, and Post-checks in ONE transaction.
--   - If real operational data exists for Station B, transaction is immediately ABORTED.
--   - Absolute protection of Station A historical data.
-- ==============================================================================

BEGIN;

-- Cấu hình thời gian chờ khóa an toàn (Lock Timeout): Thất bại và rollback nếu không lấy được khóa sau 10s
SET LOCAL lock_timeout = '10s';

-- ==============================================================================
-- 1. PRE-ROLLBACK SAFETY CHECKS (KIỂM TRA DỮ LIỆU PHỤ THUỘC TRONG TRANSACTION)
-- ==============================================================================
DO $$
DECLARE
    v_b_sensor_readings INTEGER;
    v_b_collection_records INTEGER;
    v_b_alerts INTEGER;
    v_b_watermarks INTEGER;
    v_b_ledgers INTEGER;
BEGIN
    -- 1.1. Kiểm tra SensorReading của Trạm B: Nếu đã có dữ liệu thật thì KHÔNG ĐƯỢC XÓA TỰ ĐỘNG
    SELECT count(*) INTO v_b_sensor_readings
    FROM "public"."SensorReading"
    WHERE "binId" IN (
        'bin_station_b_recyclable_id',
        'bin_station_b_non_recyclable_id',
        'bin_station_b_organic_id'
    );

    IF v_b_sensor_readings > 0 THEN
        RAISE EXCEPTION 'ROLLBACK ABORTED FOR SAFETY: Station B has already accumulated % SensorReading(s)! Automatic rollback is prohibited to prevent production data loss. Manual DBA review required.', v_b_sensor_readings;
    END IF;

    -- 1.2. Kiểm tra CollectionRecord của Trạm B
    SELECT count(*) INTO v_b_collection_records
    FROM "public"."CollectionRecord"
    WHERE "binId" IN (
        'bin_station_b_recyclable_id',
        'bin_station_b_non_recyclable_id',
        'bin_station_b_organic_id'
    );

    IF v_b_collection_records > 0 THEN
        RAISE EXCEPTION 'ROLLBACK ABORTED FOR SAFETY: Station B has % CollectionRecord(s)! Rollback aborted to protect collection audit trail.', v_b_collection_records;
    END IF;

    -- 1.3. Kiểm tra Alert của Trạm B
    SELECT count(*) INTO v_b_alerts
    FROM "public"."Alert"
    WHERE "binId" IN (
        'bin_station_b_recyclable_id',
        'bin_station_b_non_recyclable_id',
        'bin_station_b_organic_id'
    );

    IF v_b_alerts > 0 THEN
        RAISE EXCEPTION 'ROLLBACK ABORTED FOR SAFETY: Station B has % Alert record(s)! Rollback aborted.', v_b_alerts;
    END IF;

    -- 1.4. Kiểm tra Watermark và Ledger của Trạm B
    SELECT count(*) INTO v_b_watermarks FROM "public"."StationWatermark" WHERE "stationCode" = 'STATION_B';
    SELECT count(*) INTO v_b_ledgers FROM "public"."TelemetryIdempotencyLedger" WHERE "stationCode" = 'STATION_B';

    IF v_b_watermarks > 0 OR v_b_ledgers > 0 THEN
        RAISE EXCEPTION 'ROLLBACK ABORTED FOR SAFETY: Station B has telemetry ledger records (watermarks=%, ledgers=%) indicating active transmission!', v_b_watermarks, v_b_ledgers;
    END IF;

    RAISE NOTICE 'PRE-ROLLBACK CHECKS PASSED: Station B has zero operational data. Safe to execute baseline rollback.';
END $$;

-- ------------------------------------------------------------------------------
-- BƯỚC 1: XÓA ĐÚNG 3 THÙNG RÁC CỦA TRẠM B (THEO ID CHÍNH XÁC ĐÃ CẤP PHÁT)
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
-- Bảo toàn 100% dữ liệu mức đầy, dung tích và lịch sử cảm biến Trạm A
-- ------------------------------------------------------------------------------
UPDATE "public"."Bin"
SET "stationId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "binCode" IN ('ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE')
  AND "stationId" = 'station_a_canonical_id';

-- ------------------------------------------------------------------------------
-- BƯỚC 4: HOÀN NGUYÊN CHỈ MỤC DUY NHẤT TOÀN CỤC Bin_binCode_key
-- ------------------------------------------------------------------------------
ALTER TABLE public."Bin"
DROP CONSTRAINT IF EXISTS "Bin_stationId_binCode_key";

DROP INDEX IF EXISTS public."Bin_stationId_binCode_key";

ALTER TABLE public."Bin"
DROP CONSTRAINT IF EXISTS "Bin_binCode_idx";

DROP INDEX IF EXISTS public."Bin_binCode_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "Bin_binCode_key" 
ON "public"."Bin" ("binCode");

-- ------------------------------------------------------------------------------
-- BƯỚC 5: CẬP NHẬT VÀ GHI VẾT HOÀN NGUYÊN VÀO BẢNG _migration_provenance (IDEMPOTENT)
-- ------------------------------------------------------------------------------
UPDATE "public"."_migration_provenance"
SET "status" = 'ROLLED_BACK',
    "rolled_back_at" = CURRENT_TIMESTAMP
WHERE "phase" = 'PHASE_3' 
  AND "action" = 'CONTROLLED_DATA_REPAIR' 
  AND "status" = 'APPLIED';

INSERT INTO "public"."_migration_provenance" (
    "phase", 
    "action", 
    "target", 
    "status", 
    "notes"
)
SELECT
    'PHASE_3',
    'ROLLBACK_DATA_REPAIR',
    'Station A & B Bins',
    'APPLIED',
    'Round 20.7 rollback: Reverted stationId to NULL, removed Station B and its 3 empty bins, restored global Bin_binCode_key index.'
WHERE NOT EXISTS (
    SELECT 1 FROM "public"."_migration_provenance"
    WHERE "phase" = 'PHASE_3' AND "action" = 'ROLLBACK_DATA_REPAIR' AND "status" = 'APPLIED'
);

-- ==============================================================================
-- BƯỚC 6: POST-ROLLBACK CHECKS (XÁC MINH TRẠNG THÁI BASELINE TRONG TRANSACTION)
-- ==============================================================================
DO $$
DECLARE
    v_stations_count INTEGER;
    v_station_b_exists INTEGER;
    v_bins_count INTEGER;
    v_null_bins_count INTEGER;
    v_restored_index_valid INTEGER;
    v_old_compound_index_count INTEGER;
    v_is_unique BOOLEAN;
    v_is_valid BOOLEAN;
    v_is_ready BOOLEAN;
    v_col1 TEXT;
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

    -- 6.5. Kiểm tra định nghĩa index sau rollback trong PostgreSQL catalog
    SELECT 
        i.indisunique,
        i.indisvalid,
        i.indisready,
        replace(pg_get_indexdef(i.indexrelid, 1, true), '"', '')
    INTO 
        v_is_unique,
        v_is_valid,
        v_is_ready,
        v_col1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'Bin'
      AND c.relname = 'Bin_binCode_key';

    IF v_is_unique IS NOT TRUE OR v_is_valid IS NOT TRUE OR v_is_ready IS NOT TRUE OR v_col1 != 'binCode' THEN
        RAISE EXCEPTION 'ROLLBACK POST-CHECK FAILED: Restored Bin_binCode_key index is invalid in catalog (unique=%, valid=%, ready=%, col=%)!', v_is_unique, v_is_valid, v_is_ready, v_col1;
    END IF;

    -- Index tổ hợp Bin_stationId_binCode_key phải bị xóa hoàn toàn
    SELECT count(*) INTO v_old_compound_index_count
    FROM pg_class c
    JOIN pg_index i ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'Bin' AND c.relname = 'Bin_stationId_binCode_key';

    IF v_old_compound_index_count > 0 THEN
        RAISE EXCEPTION 'ROLLBACK POST-CHECK FAILED: Compound index Bin_stationId_binCode_key still exists after rollback!';
    END IF;

    RAISE NOTICE 'ROLLBACK POST-CHECKS PASSED: Database restored to exact pre-repair state.';
END $$;

COMMIT;
-- ==============================================================================
-- END OF SCRIPT: round20_3_multi_station_repair_rollback.sql (Round 20.7 Revision)
-- ==============================================================================
