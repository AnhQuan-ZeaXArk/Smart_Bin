-- ==============================================================================
-- SMARTBIN MULTI-STATION: CONTROLLED BACKFILL SCRIPT (PHASE 3)
-- Target: PostgreSQL Database
-- Purpose: Atomically backfill all existing legacy bins to Station A canonical ID.
-- Golden Rules:
-- 1. Never overwrite existing stationId.
-- 2. Validate pre-conditions and post-conditions.
-- 3. Abort transaction immediately if duplicate binCode exists.
-- 4. Never impact Station B bins.
-- ==============================================================================

-- ==============================================================================
-- 1. BƯỚC KIỂM TRA ĐIỀU KIỆN TIÊN QUYẾT (PRE-CHECKS)
-- ==============================================================================

-- 1.1. Xác minh Trạm A canonical tồn tại trong bảng Station
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "public"."Station" WHERE "id" = 'station_a_canonical_id' OR "code" = 'STATION_A') THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Station A canonical record does not exist in table Station!';
    END IF;
END $$;

-- 1.2. Kiểm tra xung đột binCode trùng lặp trước khi gán
DO $$
DECLARE
    v_dup_count INTEGER;
BEGIN
    SELECT count(*) INTO v_dup_count
    FROM (
        SELECT "binCode"
        FROM "public"."Bin"
        WHERE "stationId" IS NULL OR "stationId" = 'station_a_canonical_id'
        GROUP BY "binCode"
        HAVING count(*) > 1
    ) sub;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Found % duplicate binCode(s) for Station A! Aborting backfill.', v_dup_count;
    END IF;
END $$;

-- 1.3. Thống kê trước khi thực hiện
SELECT 
    count(*) AS total_bins_in_system,
    count(*) FILTER (WHERE "stationId" IS NULL) AS legacy_bins_to_backfill,
    count(*) FILTER (WHERE "stationId" = 'station_a_canonical_id') AS already_station_a_bins,
    count(*) FILTER (WHERE "stationId" IS NOT NULL AND "stationId" != 'station_a_canonical_id') AS other_station_bins
FROM "public"."Bin";

-- ==============================================================================
-- 2. BƯỚC THỰC THI GIAO DỊCH NGUYÊN TỬ (ATOMIC TRANSACTION)
-- ==============================================================================
BEGIN;

-- Tạo bảng theo dõi tạm thời (dùng để kiểm toán và rollback chính xác nếu cần)
CREATE TEMP TABLE "_temp_backfill_tracker" AS
SELECT "id", "binCode"
FROM "public"."Bin"
WHERE "stationId" IS NULL;

-- Cập nhật: CHỈ CẬP NHẬT CÁC BIN CÓ stationId IS NULL, TUYỆT ĐỐI KHÔNG GHI ĐÈ
UPDATE "public"."Bin"
SET "stationId" = 'station_a_canonical_id',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "stationId" IS NULL;

-- Ghi nhận lịch sử kiểm toán bất biến vào bảng _migration_provenance
INSERT INTO "public"."_migration_provenance" ("phase", "action", "target", "status", "notes")
VALUES (
    'PHASE_3', 
    'DATA_BACKFILL', 
    'Bin.stationId -> station_a_canonical_id', 
    'APPLIED', 
    format('Backfilled %s bins to Station A canonical ID', (SELECT count(*) FROM "_temp_backfill_tracker"))
);

COMMIT;

-- ==============================================================================
-- 3. BƯỚC XÁC MINH SAU KHI BACKFILL (POST-CHECKS)
-- ==============================================================================
DO $$
DECLARE
    v_remaining_null INTEGER;
BEGIN
    SELECT count(*) INTO v_remaining_null
    FROM "public"."Bin"
    WHERE "stationId" IS NULL;

    IF v_remaining_null > 0 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: There are still % unassigned bins with stationId IS NULL!', v_remaining_null;
    END IF;
END $$;

-- Báo cáo xác nhận cuối cùng
SELECT 
    count(*) AS total_bins,
    count(*) FILTER (WHERE "stationId" = 'station_a_canonical_id') AS station_a_bins,
    count(*) FILTER (WHERE "stationId" IS NULL) AS remaining_null_bins
FROM "public"."Bin";

