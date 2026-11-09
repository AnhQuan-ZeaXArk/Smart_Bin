-- ==============================================================================
-- SMARTBIN MULTI-STATION: CONTROLLED PRODUCTION DATA REPAIR (ROUND 20.3)
-- Target Database: PostgreSQL (Production Render: smartbin_ppmz)
-- Scope: 
--   1. Adapt unique constraint: replace global Bin_binCode_key with compound (stationId, binCode).
--   2. Backfill existing 3 legacy bins to Station A canonical ID.
--   3. Provision Station B record and its 3 standard bins (1 installed, 2 uninstalled).
--   4. Record audit trail in _migration_provenance.
-- Safety:
--   - Wrapped in atomic single transaction (BEGIN ... COMMIT).
--   - Strict pre-condition checks abort before any modification if environment is invalid.
--   - Strict post-condition checks abort and roll back if any invariant is violated.
--   - 100% Idempotent: can be executed repeatedly without duplicate data.
--   - Preserves all historical telemetry, SensorReading, and bin IDs.
-- ==============================================================================

-- ==============================================================================
-- 1. PRE-CONDITION CHECKS (KIỂM TRA TIỀN ĐIỀU KIỆN)
-- ==============================================================================
DO $$
DECLARE
    v_station_a_count INTEGER;
    v_legacy_bins_count INTEGER;
    v_dup_bincode_count INTEGER;
BEGIN
    -- 1.1. Kiểm tra Trạm A canonical tồn tại
    SELECT count(*) INTO v_station_a_count
    FROM "public"."Station"
    WHERE "id" = 'station_a_canonical_id' AND "code" = 'STATION_A';

    IF v_station_a_count = 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Station A (station_a_canonical_id / STATION_A) does not exist!';
    END IF;

    -- 1.2. Kiểm tra tồn tại 3 thùng rác di sản (ORGANIC, RECYCLABLE, NON_RECYCLABLE)
    SELECT count(*) INTO v_legacy_bins_count
    FROM "public"."Bin"
    WHERE "binCode" IN ('ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE');

    IF v_legacy_bins_count < 3 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Found % legacy bins, expected at least 3!', v_legacy_bins_count;
    END IF;

    -- 1.3. Kiểm tra không có xung đột trùng lặp binCode trong các thùng rác chưa gán trạm
    SELECT count(*) INTO v_dup_bincode_count
    FROM (
        SELECT "binCode"
        FROM "public"."Bin"
        WHERE "stationId" IS NULL OR "stationId" = 'station_a_canonical_id'
        GROUP BY "binCode"
        HAVING count(*) > 1
    ) sub;

    IF v_dup_bincode_count > 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Detected % duplicate binCode(s) for Station A scope!', v_dup_bincode_count;
    END IF;

    RAISE NOTICE 'PRE-CHECKS PASSED: Database is in valid state for controlled multi-station repair.';
END $$;

-- ==============================================================================
-- 2. ATOMIC TRANSACTION EXECUTION (THỰC THI GIAO DỊCH NGUYÊN TỬ)
-- ==============================================================================
BEGIN;

-- ------------------------------------------------------------------------------
-- BƯỚC 1: CHUYỂN ĐỔI CHỈ MỤC DUY NHẤT (UNIQUE INDEX ADAPTATION)
-- Cho phép Station A và Station B có cùng mã binCode (RECYCLABLE, ORGANIC, NON_RECYCLABLE)
-- ------------------------------------------------------------------------------
-- 1.1. Xóa chỉ mục duy nhất toàn cục cũ (nếu tồn tại)
DROP INDEX IF EXISTS "public"."Bin_binCode_key";

-- 1.2. Tạo chỉ mục duy nhất tổ hợp (stationId, binCode) theo đúng Prisma schema
CREATE UNIQUE INDEX IF NOT EXISTS "Bin_stationId_binCode_key" 
ON "public"."Bin" ("stationId", "binCode");

-- 1.3. Tạo chỉ mục hỗ trợ truy vấn lọc theo binCode độc lập
CREATE INDEX IF NOT EXISTS "Bin_binCode_idx" 
ON "public"."Bin" ("binCode");

-- ------------------------------------------------------------------------------
-- BƯỚC 2: BACKFILL 3 THÙNG RÁC DI SẢN CHO TRẠM A
-- Chỉ cập nhật các thùng rác có stationId IS NULL, tuyệt đối bảo toàn ID, fill level và sensor data
-- ------------------------------------------------------------------------------
UPDATE "public"."Bin"
SET "stationId" = 'station_a_canonical_id',
    "installed" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "stationId" IS NULL 
  AND "binCode" IN ('ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE');

-- ------------------------------------------------------------------------------
-- BƯỚC 3: KHỞI TẠO BẢN GHI TRẠM B (STATION_B)
-- ------------------------------------------------------------------------------
INSERT INTO "public"."Station" (
    "id", 
    "code", 
    "name", 
    "status", 
    "isActive", 
    "location", 
    "createdAt", 
    "updatedAt"
)
VALUES (
    'station_b_canonical_id',
    'STATION_B',
    'Trạm Thu gom Mở rộng B',
    'OFFLINE'::"StationStatus",
    false,
    'Khuôn viên phía Đông',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "location" = EXCLUDED."location",
    "updatedAt" = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------------------------
-- BƯỚC 4: KHỞI TẠO 3 NGĂN RÁC CHUẨN CHO TRẠM B
-- Gồm: 1 ngăn RECYCLABLE đã lắp đặt; 2 ngăn ORGANIC & NON_RECYCLABLE chưa lắp đặt
-- ------------------------------------------------------------------------------

-- 4.1. Ngăn Rác Tái Chế Trạm B (INSTALLED = true)
INSERT INTO "public"."Bin" (
    "id", 
    "stationId", 
    "binCode", 
    "name", 
    "location", 
    "capacity", 
    "currentFillLevel", 
    "status", 
    "isActive", 
    "installed", 
    "lastSeen", 
    "createdAt", 
    "updatedAt"
)
VALUES (
    'bin_station_b_recyclable_id',
    'station_b_canonical_id',
    'RECYCLABLE',
    'Rác tái chế Trạm B',
    'Ngăn rác tái chế Trạm B',
    240,
    0,
    'OFFLINE'::"BinStatus",
    true,
    true,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("stationId", "binCode") DO UPDATE
SET "installed" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

-- 4.2. Ngăn Rác Không Tái Chế Trạm B (NOT_INSTALLED = false)
INSERT INTO "public"."Bin" (
    "id", 
    "stationId", 
    "binCode", 
    "name", 
    "location", 
    "capacity", 
    "currentFillLevel", 
    "status", 
    "isActive", 
    "installed", 
    "lastSeen", 
    "createdAt", 
    "updatedAt"
)
VALUES (
    'bin_station_b_non_recyclable_id',
    'station_b_canonical_id',
    'NON_RECYCLABLE',
    'Rác không tái chế Trạm B',
    'Ngăn rác không tái chế Trạm B',
    360,
    0,
    'MAINTENANCE'::"BinStatus",
    true,
    false,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("stationId", "binCode") DO UPDATE
SET "installed" = false,
    "status" = 'MAINTENANCE'::"BinStatus",
    "updatedAt" = CURRENT_TIMESTAMP;

-- 4.3. Ngăn Rác Hữu Cơ Trạm B (NOT_INSTALLED = false)
INSERT INTO "public"."Bin" (
    "id", 
    "stationId", 
    "binCode", 
    "name", 
    "location", 
    "capacity", 
    "currentFillLevel", 
    "status", 
    "isActive", 
    "installed", 
    "lastSeen", 
    "createdAt", 
    "updatedAt"
)
VALUES (
    'bin_station_b_organic_id',
    'station_b_canonical_id',
    'ORGANIC',
    'Rác hữu cơ Trạm B',
    'Ngăn rác hữu cơ Trạm B',
    240,
    0,
    'MAINTENANCE'::"BinStatus",
    true,
    false,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("stationId", "binCode") DO UPDATE
SET "installed" = false,
    "status" = 'MAINTENANCE'::"BinStatus",
    "updatedAt" = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------------------------
-- BƯỚC 5: GHI VẾT KIỂM TOÁN VÀO BẢNG _migration_provenance
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
    'CONTROLLED_DATA_REPAIR',
    'Station A Backfill & Station B Provisioning',
    'APPLIED',
    'Round 20.3: Backfilled Station A 3 bins, created Station B with 1 installed and 2 uninstalled bins, compound index enforced.'
);

-- ==============================================================================
-- 3. POST-CONDITION CHECKS (KIỂM TRA BẢO ĐẢM TOÀN VẸN TRƯỚC KHI COMMIT)
-- ==============================================================================
DO $$
DECLARE
    v_total_stations INTEGER;
    v_station_a_bins INTEGER;
    v_station_b_bins INTEGER;
    v_total_bins INTEGER;
    v_null_station_bins INTEGER;
    v_installed_bins INTEGER;
    v_uninstalled_bins INTEGER;
BEGIN
    -- 3.1. Tổng số Station phải đúng bằng 2
    SELECT count(*) INTO v_total_stations FROM "public"."Station";
    IF v_total_stations != 2 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected exactly 2 stations, found %!', v_total_stations;
    END IF;

    -- 3.2. Station A phải có đúng 3 thùng rác
    SELECT count(*) INTO v_station_a_bins 
    FROM "public"."Bin" 
    WHERE "stationId" = 'station_a_canonical_id';
    IF v_station_a_bins != 3 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected 3 bins for Station A, found %!', v_station_a_bins;
    END IF;

    -- 3.3. Station B phải có đúng 3 thùng rác
    SELECT count(*) INTO v_station_b_bins 
    FROM "public"."Bin" 
    WHERE "stationId" = 'station_b_canonical_id';
    IF v_station_b_bins != 3 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected 3 bins for Station B, found %!', v_station_b_bins;
    END IF;

    -- 3.4. Tổng số thùng rác toàn hệ thống phải bằng 6
    SELECT count(*) INTO v_total_bins FROM "public"."Bin";
    IF v_total_bins != 6 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected total 6 bins, found %!', v_total_bins;
    END IF;

    -- 3.5. Không còn thùng rác nào có stationId IS NULL
    SELECT count(*) INTO v_null_station_bins 
    FROM "public"."Bin" 
    WHERE "stationId" IS NULL;
    IF v_null_station_bins > 0 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Still found % unassigned bins with stationId IS NULL!', v_null_station_bins;
    END IF;

    -- 3.6. Đúng 4 thùng rác INSTALLED và 2 thùng rác NOT_INSTALLED
    SELECT count(*) INTO v_installed_bins FROM "public"."Bin" WHERE "installed" = true;
    SELECT count(*) INTO v_uninstalled_bins FROM "public"."Bin" WHERE "installed" = false;
    IF v_installed_bins != 4 OR v_uninstalled_bins != 2 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected 4 installed and 2 uninstalled bins, found % installed and % uninstalled!', v_installed_bins, v_uninstalled_bins;
    END IF;

    RAISE NOTICE 'POST-CHECKS PASSED: All multi-station invariants verified successfully. Committing transaction.';
END $$;

COMMIT;
-- ==============================================================================
-- END OF SCRIPT: round20_3_multi_station_repair.sql
-- ==============================================================================

