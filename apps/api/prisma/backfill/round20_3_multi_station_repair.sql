-- ==============================================================================
-- SMARTBIN MULTI-STATION: CONTROLLED PRODUCTION DATA REPAIR (ROUND 20.7)
-- Target Database: PostgreSQL (Production Render: smartbin_ppmz)
-- Scope: 
--   1. Replace legacy global unique index Bin_binCode_key with compound UNIQUE (stationId, binCode).
--   2. Backfill existing 3 legacy bins to Station A canonical ID (station_a_canonical_id).
--   3. Provision Station B record (isActive = true, status = OFFLINE) and its 3 standard bins:
--      - RECYCLABLE: installed = true, status = OFFLINE, lastSeen = NULL, currentFillLevel = 0
--      - ORGANIC: installed = false, status = MAINTENANCE, lastSeen = NULL, currentFillLevel = 0
--      - NON_RECYCLABLE: installed = false, status = MAINTENANCE, lastSeen = NULL, currentFillLevel = 0
--   4. Idempotent audit trail in _migration_provenance.
-- Safety & Invariants:
--   - Single atomic transaction: Pre-checks, DDL, DML, and Post-checks in ONE transaction.
--   - Pre-checks strictly verify Station A identity, legacy bins, Station B ID reservations, and Foreign Keys.
--   - Post-checks strictly inspect PostgreSQL system catalog for Index validity (is_unique, is_valid, is_ready, column order: stationId -> binCode).
--   - Zero fake sensor data created; preserves 100% of Station A historical data.
--   - If ANY check fails, the transaction is immediately aborted and rolled back.
-- ==============================================================================

BEGIN;

-- Cấu hình thời gian chờ khóa an toàn (Lock Timeout): Thất bại và rollback nếu không lấy được khóa sau 10s
SET LOCAL lock_timeout = '10s';

-- ==============================================================================
-- 1. PRE-CONDITION CHECKS (KIỂM TRA TIỀN ĐIỀU KIỆN TRONG TRANSACTION)
-- ==============================================================================
DO $$
DECLARE
    v_station_a_count INTEGER;
    v_legacy_bins_count INTEGER;
    v_invalid_station_bin_count INTEGER;
    v_dup_bincode_count INTEGER;
    v_station_b_code_mismatch INTEGER;
    v_station_b_id_mismatch INTEGER;
    v_station_b_id_conflict INTEGER;
    v_fk_station_count INTEGER;
BEGIN
    -- 1.1. Kiểm tra Trạm A canonical tồn tại chính xác
    SELECT count(*) INTO v_station_a_count
    FROM "public"."Station"
    WHERE "id" = 'station_a_canonical_id' AND "code" = 'STATION_A';

    IF v_station_a_count != 1 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Station A (station_a_canonical_id / STATION_A) does not exist or is duplicate (count=%)!', v_station_a_count;
    END IF;

    -- 1.2. Kiểm tra tồn tại đúng 3 thùng rác di sản (ORGANIC, RECYCLABLE, NON_RECYCLABLE)
    SELECT count(*) INTO v_legacy_bins_count
    FROM "public"."Bin"
    WHERE "binCode" IN ('ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE')
      AND ("stationId" IS NULL OR "stationId" = 'station_a_canonical_id');

    IF v_legacy_bins_count < 3 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Found % legacy bins eligible for Station A, expected at least 3!', v_legacy_bins_count;
    END IF;

    -- 1.3. Kiểm tra không có thùng rác di sản nào đang bị gán sai cho một trạm khác
    SELECT count(*) INTO v_invalid_station_bin_count
    FROM "public"."Bin"
    WHERE "binCode" IN ('ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE')
      AND "stationId" IS NOT NULL 
      AND "stationId" != 'station_a_canonical_id'
      AND "id" NOT IN ('bin_station_b_recyclable_id', 'bin_station_b_non_recyclable_id', 'bin_station_b_organic_id');

    IF v_invalid_station_bin_count > 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Detected % bin(s) with legacy binCode assigned to an unknown station!', v_invalid_station_bin_count;
    END IF;

    -- 1.4. Kiểm tra không có xung đột trùng lặp binCode trong phạm vi Trạm A
    SELECT count(*) INTO v_dup_bincode_count
    FROM (
        SELECT "binCode"
        FROM "public"."Bin"
        WHERE "stationId" IS NULL OR "stationId" = 'station_a_canonical_id'
        GROUP BY "binCode"
        HAVING count(*) > 1
    ) sub;

    IF v_dup_bincode_count > 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Detected % duplicate binCode(s) in Station A scope!', v_dup_bincode_count;
    END IF;

    -- 1.5. Kiểm tra tính hợp lệ của Station B nếu đã tồn tại
    SELECT count(*) INTO v_station_b_code_mismatch
    FROM "public"."Station"
    WHERE "code" = 'STATION_B' AND "id" != 'station_b_canonical_id';

    IF v_station_b_code_mismatch > 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Station with code STATION_B exists with non-canonical ID!';
    END IF;

    SELECT count(*) INTO v_station_b_id_mismatch
    FROM "public"."Station"
    WHERE "id" = 'station_b_canonical_id' AND "code" != 'STATION_B';

    IF v_station_b_id_mismatch > 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Station with id station_b_canonical_id exists with non-canonical code!';
    END IF;

    -- 1.6. Kiểm tra các ID được bảo lưu cho 3 thùng rác Trạm B không bị xung đột với dữ liệu khác
    SELECT count(*) INTO v_station_b_id_conflict
    FROM "public"."Bin"
    WHERE "id" IN ('bin_station_b_recyclable_id', 'bin_station_b_non_recyclable_id', 'bin_station_b_organic_id')
      AND (
          ("id" = 'bin_station_b_recyclable_id' AND "binCode" != 'RECYCLABLE') OR
          ("id" = 'bin_station_b_non_recyclable_id' AND "binCode" != 'NON_RECYCLABLE') OR
          ("id" = 'bin_station_b_organic_id' AND "binCode" != 'ORGANIC') OR
          ("stationId" IS NOT NULL AND "stationId" != 'station_b_canonical_id')
      );

    IF v_station_b_id_conflict > 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Reserved Station B Bin ID(s) are occupied by conflicting records!';
    END IF;

    -- 1.7. Kiểm tra ràng buộc khóa ngoại Bin.stationId -> Station.id tồn tại trong DB
    SELECT count(*) INTO v_fk_station_count
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'Bin' 
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'stationId';

    IF v_fk_station_count = 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Foreign key constraint Bin.stationId -> Station.id does not exist!';
    END IF;

    RAISE NOTICE 'PRE-CHECKS PASSED: All database integrity conditions verified successfully.';
END $$;

-- ------------------------------------------------------------------------------
-- BƯỚC 1: CHUYỂN ĐỔI CHỈ MỤC DUY NHẤT (UNIQUE INDEX ADAPTATION)
-- Cho phép Station A và Station B có cùng mã binCode (RECYCLABLE, ORGANIC, NON_RECYCLABLE)
-- ------------------------------------------------------------------------------
-- 1.1. Xóa ràng buộc duy nhất và chỉ mục toàn cục cũ (nếu tồn tại)
ALTER TABLE public."Bin"
DROP CONSTRAINT IF EXISTS "Bin_binCode_key";

DROP INDEX IF EXISTS public."Bin_binCode_key";

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
-- QUY TẮC BẤT BIẾN:
-- - isActive = true (để được phép hiển thị trên Dashboard và các API truy vấn)
-- - status = 'OFFLINE' (giữ OFFLINE cho đến khi có heartbeat hợp lệ từ phần cứng thực tế)
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
    true,
    'Khuôn viên phía Đông',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "isActive" = true,
    "location" = EXCLUDED."location",
    "updatedAt" = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------------------------
-- BƯỚC 4: KHỞI TẠO 3 NGĂN RÁC CHUẨN CHO TRẠM B
-- Gồm: 1 ngăn RECYCLABLE đã lắp đặt; 2 ngăn ORGANIC & NON_RECYCLABLE chưa lắp đặt
-- Lưu ý: currentFillLevel phải đặt 0 do ràng buộc NOT NULL của PostgreSQL.
-- Logic Backend (bin-sync.service.ts) và Frontend (bin-view-model.ts) sẽ tự động
-- ánh xạ installed=false thành currentFillLevel=null và hiển thị ký hiệu '—' (Chưa lắp đặt).
-- ------------------------------------------------------------------------------

-- 4.1. Ngăn Rác Tái Chế Trạm B (INSTALLED = true, OFFLINE)
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
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

-- 4.2. Ngăn Rác Không Tái Chế Trạm B (NOT_INSTALLED = false, MAINTENANCE)
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
    "isActive" = true,
    "status" = 'MAINTENANCE'::"BinStatus",
    "updatedAt" = CURRENT_TIMESTAMP;

-- 4.3. Ngăn Rác Hữu Cơ Trạm B (NOT_INSTALLED = false, MAINTENANCE)
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
    "isActive" = true,
    "status" = 'MAINTENANCE'::"BinStatus",
    "updatedAt" = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------------------------
-- BƯỚC 5: GHI VẾT KIỂM TOÁN VÀO BẢNG _migration_provenance (IDEMPOTENT)
-- ------------------------------------------------------------------------------
INSERT INTO "public"."_migration_provenance" (
    "phase", 
    "action", 
    "target", 
    "status", 
    "notes"
)
SELECT
    'PHASE_3',
    'CONTROLLED_DATA_REPAIR',
    'Station A Backfill & Station B Provisioning',
    'APPLIED',
    'Round 20.7: Backfilled Station A 3 bins, created Station B with isActive=true (status=OFFLINE), 1 installed and 2 uninstalled bins, compound index enforced.'
WHERE NOT EXISTS (
    SELECT 1 FROM "public"."_migration_provenance"
    WHERE "phase" = 'PHASE_3' AND "action" = 'CONTROLLED_DATA_REPAIR' AND "status" = 'APPLIED'
);

-- ==============================================================================
-- 3. POST-CONDITION CHECKS (KIỂM TRA BẢO ĐẢM TOÀN VẸN TRƯỚC KHI COMMIT)
-- ==============================================================================
DO $$
DECLARE
    v_total_stations INTEGER;
    v_station_b_status TEXT;
    v_station_b_is_active BOOLEAN;
    v_station_a_bins INTEGER;
    v_station_b_bins INTEGER;
    v_total_bins INTEGER;
    v_null_station_bins INTEGER;
    v_installed_bins INTEGER;
    v_uninstalled_bins INTEGER;
    v_station_b_fake_readings INTEGER;
    v_old_unique_index_count INTEGER;
    v_old_unique_constraint_count INTEGER;
    v_is_unique BOOLEAN;
    v_is_valid BOOLEAN;
    v_is_ready BOOLEAN;
    v_key_atts INTEGER;
    v_col1 TEXT;
    v_col2 TEXT;
BEGIN
    -- 3.1. Tổng số Station phải đúng bằng 2
    SELECT count(*) INTO v_total_stations FROM "public"."Station";
    IF v_total_stations != 2 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected exactly 2 stations, found %!', v_total_stations;
    END IF;

    -- 3.2. Station B phải có status = OFFLINE và isActive = true
    SELECT "status"::text, "isActive" INTO v_station_b_status, v_station_b_is_active
    FROM "public"."Station"
    WHERE "id" = 'station_b_canonical_id' AND "code" = 'STATION_B';

    IF v_station_b_status != 'OFFLINE' THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Station B status must be OFFLINE, found %!', v_station_b_status;
    END IF;
    IF v_station_b_is_active != true THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Station B isActive must be true, found false!';
    END IF;

    -- 3.3. Station A phải có đúng 3 thùng rác
    SELECT count(*) INTO v_station_a_bins 
    FROM "public"."Bin" 
    WHERE "stationId" = 'station_a_canonical_id';
    IF v_station_a_bins != 3 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected 3 bins for Station A, found %!', v_station_a_bins;
    END IF;

    -- 3.4. Station B phải có đúng 3 thùng rác
    SELECT count(*) INTO v_station_b_bins 
    FROM "public"."Bin" 
    WHERE "stationId" = 'station_b_canonical_id';
    IF v_station_b_bins != 3 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected 3 bins for Station B, found %!', v_station_b_bins;
    END IF;

    -- 3.5. Tổng số thùng rác toàn hệ thống phải bằng 6
    SELECT count(*) INTO v_total_bins FROM "public"."Bin";
    IF v_total_bins != 6 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected total 6 bins, found %!', v_total_bins;
    END IF;

    -- 3.6. Không còn thùng rác nào có stationId IS NULL
    SELECT count(*) INTO v_null_station_bins 
    FROM "public"."Bin" 
    WHERE "stationId" IS NULL;
    IF v_null_station_bins > 0 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Still found % unassigned bins with stationId IS NULL!', v_null_station_bins;
    END IF;

    -- 3.7. Đúng 4 thùng rác INSTALLED và 2 thùng rác NOT_INSTALLED
    SELECT count(*) INTO v_installed_bins FROM "public"."Bin" WHERE "installed" = true;
    SELECT count(*) INTO v_uninstalled_bins FROM "public"."Bin" WHERE "installed" = false;
    IF v_installed_bins != 4 OR v_uninstalled_bins != 2 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Expected 4 installed and 2 uninstalled bins, found % installed and % uninstalled!', v_installed_bins, v_uninstalled_bins;
    END IF;

    -- 3.8. Tuyệt đối KHÔNG có SensorReading giả cho Trạm B
    SELECT count(*) INTO v_station_b_fake_readings 
    FROM "public"."SensorReading"
    WHERE "binId" IN (
        SELECT "id" FROM "public"."Bin" WHERE "stationId" = 'station_b_canonical_id'
    );
    IF v_station_b_fake_readings > 0 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Found % fake sensor readings for Station B!', v_station_b_fake_readings;
    END IF;

    -- 3.9. Kiểm tra định nghĩa thực tế của Index trong PostgreSQL Catalog
    -- a. Index hoặc Constraint duy nhất toàn cục cũ Bin_binCode_key không còn tồn tại
    SELECT count(*) INTO v_old_unique_index_count
    FROM pg_class c
    JOIN pg_index i ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'Bin' AND c.relname = 'Bin_binCode_key';

    SELECT count(*) INTO v_old_unique_constraint_count
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'Bin' AND con.conname = 'Bin_binCode_key';

    IF v_old_unique_index_count > 0 OR v_old_unique_constraint_count > 0 THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Global unique index or constraint Bin_binCode_key still exists in catalog!';
    END IF;

    -- b. Truy vấn trực tiếp pg_index kiểm tra tính hợp lệ và thứ tự cột chính xác: stationId -> binCode
    SELECT 
        i.indisunique,
        i.indisvalid,
        i.indisready,
        i.indnkeyatts,
        replace(pg_get_indexdef(i.indexrelid, 1, true), '"', ''),
        replace(pg_get_indexdef(i.indexrelid, 2, true), '"', '')
    INTO 
        v_is_unique,
        v_is_valid,
        v_is_ready,
        v_key_atts,
        v_col1,
        v_col2
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'Bin'
      AND c.relname = 'Bin_stationId_binCode_key';

    IF v_is_unique IS NOT TRUE OR v_is_valid IS NOT TRUE OR v_is_ready IS NOT TRUE THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Index Bin_stationId_binCode_key exists but is not UNIQUE, VALID, or READY (unique=%, valid=%, ready=%)!', v_is_unique, v_is_valid, v_is_ready;
    END IF;

    IF v_key_atts != 2 OR v_col1 != 'stationId' OR v_col2 != 'binCode' THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Index Bin_stationId_binCode_key column specification mismatch! Expected (stationId, binCode), found col1=% and col2=% (attributes count=%)', v_col1, v_col2, v_key_atts;
    END IF;

    RAISE NOTICE 'POST-CHECKS PASSED: All multi-station invariants and catalog index definitions verified successfully. Committing transaction.';
END $$;

COMMIT;
-- ==============================================================================
-- END OF SCRIPT: round20_3_multi_station_repair.sql (Round 20.7 Revision)
-- ==============================================================================
