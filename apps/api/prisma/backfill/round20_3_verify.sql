-- ==============================================================================
-- SMARTBIN MULTI-STATION: CONTROLLED VERIFICATION SCRIPT (ROUND 20.7)
-- Target Database: PostgreSQL (Production Render: smartbin_ppmz)
-- Mode: READ-ONLY (No writes, no modifications)
-- Scope:
--   Verifies data integrity, counts, constraints, index definitions, and invariants after repair.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. XÁC MINH CÁC TRẠM THU GOM (STATIONS)
-- ------------------------------------------------------------------------------
SELECT 
    "id", 
    "code", 
    "name", 
    "status", 
    "isActive", 
    "location", 
    "createdAt"
FROM "public"."Station"
ORDER BY "code" ASC;

-- ------------------------------------------------------------------------------
-- 2. XÁC MINH PHÂN BỔ THÙNG RÁC THEO TRẠM (BINS PER STATION)
-- ------------------------------------------------------------------------------
SELECT 
    s."code" AS station_code,
    s."name" AS station_name,
    b."id" AS bin_id,
    b."binCode" AS bin_code,
    b."name" AS bin_name,
    b."capacity" AS capacity_liters,
    b."currentFillLevel" AS current_fill_level,
    b."status" AS bin_status,
    b."isActive" AS is_active,
    b."installed" AS is_installed,
    b."lastSeen" AS last_seen
FROM "public"."Bin" b
JOIN "public"."Station" s ON b."stationId" = s."id"
ORDER BY s."code" ASC, b."binCode" ASC;

-- ------------------------------------------------------------------------------
-- 3. BẢNG TỔNG HỢP CHỈ SỐ BẢO ĐẢM HỆ THỐNG (SUMMARY METRICS)
-- ------------------------------------------------------------------------------
SELECT
    (SELECT count(*) FROM "public"."Station") AS total_stations,
    (SELECT count(*) FROM "public"."Bin") AS total_bins,
    (SELECT count(*) FROM "public"."Bin" WHERE "stationId" = 'station_a_canonical_id') AS station_a_bins,
    (SELECT count(*) FROM "public"."Bin" WHERE "stationId" = 'station_b_canonical_id') AS station_b_bins,
    (SELECT count(*) FROM "public"."Bin" WHERE "stationId" IS NULL) AS unassigned_null_bins,
    (SELECT count(*) FROM "public"."Bin" WHERE "installed" = true) AS installed_bins,
    (SELECT count(*) FROM "public"."Bin" WHERE "installed" = false) AS not_installed_bins,
    (SELECT count(*) FROM "public"."SensorReading" WHERE "binId" IN (
        SELECT "id" FROM "public"."Bin" WHERE "stationId" = 'station_b_canonical_id'
    )) AS station_b_fake_sensor_readings;

-- ------------------------------------------------------------------------------
-- 4. BẢNG KIỂM TRA CHỈ MỤC & ĐỊNH NGHĨA CATALOG CHI TIẾT (INDEX CATALOG VALIDATION)
-- ------------------------------------------------------------------------------
SELECT 
    c.relname AS index_name,
    i.indisunique AS is_unique,
    i.indisvalid AS is_valid,
    i.indisready AS is_ready,
    i.indnkeyatts AS num_key_columns,
    replace(pg_get_indexdef(i.indexrelid, 1, true), '"', '') AS col1,
    replace(pg_get_indexdef(i.indexrelid, 2, true), '"', '') AS col2,
    pg_get_indexdef(i.indexrelid) AS full_definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' 
  AND t.relname = 'Bin' 
  AND c.relname IN ('Bin_binCode_key', 'Bin_stationId_binCode_key', 'Bin_binCode_idx')
ORDER BY c.relname ASC;

-- ------------------------------------------------------------------------------
-- 5. LỊCH SỬ KIỂM TOÁN PROVENANCE
-- ------------------------------------------------------------------------------
SELECT 
    "id", 
    "phase", 
    "action", 
    "target", 
    "status", 
    "applied_at", 
    "notes"
FROM "public"."_migration_provenance"
ORDER BY "id" ASC;

-- ------------------------------------------------------------------------------
-- 6. TỰ ĐỘNG BẬT THÔNG BÁO KIỂM TRA ĐẠT / KHÔNG ĐẠT (ASSERT CHECKS)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_stations_count INTEGER;
    v_has_station_a INTEGER;
    v_has_station_b INTEGER;
    v_station_b_status TEXT;
    v_station_b_is_active BOOLEAN;
    v_station_a_bins INTEGER;
    v_station_b_bins INTEGER;
    v_total_bins INTEGER;
    v_null_bins INTEGER;
    v_installed_bins INTEGER;
    v_uninstalled_bins INTEGER;
    v_fake_sensor_readings INTEGER;
    v_old_index_exists INTEGER;
    v_old_constraint_exists INTEGER;
    v_is_unique BOOLEAN;
    v_is_valid BOOLEAN;
    v_is_ready BOOLEAN;
    v_key_atts INTEGER;
    v_col1 TEXT;
    v_col2 TEXT;
    v_b_installed_valid INTEGER;
    v_b_uninstalled_valid INTEGER;
BEGIN
    -- 1. Trạm
    SELECT count(*) INTO v_stations_count FROM "public"."Station";
    SELECT count(*) INTO v_has_station_a FROM "public"."Station" WHERE "code" = 'STATION_A' AND "id" = 'station_a_canonical_id';
    SELECT count(*) INTO v_has_station_b FROM "public"."Station" WHERE "code" = 'STATION_B' AND "id" = 'station_b_canonical_id';
    
    SELECT "status"::text, "isActive" INTO v_station_b_status, v_station_b_is_active 
    FROM "public"."Station" WHERE "id" = 'station_b_canonical_id';

    -- 2. Thùng rác
    SELECT count(*) INTO v_station_a_bins FROM "public"."Bin" WHERE "stationId" = 'station_a_canonical_id';
    SELECT count(*) INTO v_station_b_bins FROM "public"."Bin" WHERE "stationId" = 'station_b_canonical_id';
    SELECT count(*) INTO v_total_bins FROM "public"."Bin";
    SELECT count(*) INTO v_null_bins FROM "public"."Bin" WHERE "stationId" IS NULL;
    SELECT count(*) INTO v_installed_bins FROM "public"."Bin" WHERE "installed" = true;
    SELECT count(*) INTO v_uninstalled_bins FROM "public"."Bin" WHERE "installed" = false;

    -- 3. Cảm biến giả
    SELECT count(*) INTO v_fake_sensor_readings FROM "public"."SensorReading" 
    WHERE "binId" IN (SELECT "id" FROM "public"."Bin" WHERE "stationId" = 'station_b_canonical_id');

    -- 4. Định nghĩa index và constraint trong catalog
    SELECT count(*) INTO v_old_index_exists 
    FROM pg_class c
    JOIN pg_index i ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'Bin' AND c.relname = 'Bin_binCode_key';

    SELECT count(*) INTO v_old_constraint_exists
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'Bin' AND con.conname = 'Bin_binCode_key';

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

    -- 5. Cấu hình các thùng Trạm B
    SELECT count(*) INTO v_b_installed_valid FROM "public"."Bin" 
    WHERE "stationId" = 'station_b_canonical_id' 
      AND "binCode" = 'RECYCLABLE' 
      AND "installed" = true 
      AND "status" = 'OFFLINE'
      AND "lastSeen" IS NULL;

    SELECT count(*) INTO v_b_uninstalled_valid FROM "public"."Bin" 
    WHERE "stationId" = 'station_b_canonical_id' 
      AND "binCode" IN ('ORGANIC', 'NON_RECYCLABLE') 
      AND "installed" = false 
      AND "status" = 'MAINTENANCE'
      AND "lastSeen" IS NULL;

    -- Kiểm tra tất cả các điều kiện bắt buộc
    IF v_stations_count = 2 AND
       v_has_station_a = 1 AND
       v_has_station_b = 1 AND
       v_station_b_status = 'OFFLINE' AND
       v_station_b_is_active = true AND
       v_station_a_bins = 3 AND
       v_station_b_bins = 3 AND
       v_total_bins = 6 AND
       v_null_bins = 0 AND
       v_installed_bins = 4 AND
       v_uninstalled_bins = 2 AND
       v_fake_sensor_readings = 0 AND
       v_old_index_exists = 0 AND
       v_old_constraint_exists = 0 AND
       v_is_unique IS TRUE AND
       v_is_valid IS TRUE AND
       v_is_ready IS TRUE AND
       v_key_atts = 2 AND
       v_col1 = 'stationId' AND
       v_col2 = 'binCode' AND
       v_b_installed_valid = 1 AND
       v_b_uninstalled_valid = 2 THEN
        RAISE NOTICE '>>> [PASS] ALL ROUND 20.7 VERIFICATION CRITERIA MET PERFECTLY! <<<';
    ELSE
        RAISE EXCEPTION '>>> [FAIL] ONE OR MORE CRITERIA NOT MET! Stations: %, A: %, B: %, B_Status: %, B_Active: %, TotalBins: %, NullBins: %, FakeReadings: %, OldIndex: %, OldConstraint: %, IndexValid: %, Col1: %, Col2: % <<<',
            v_stations_count, v_has_station_a, v_has_station_b, v_station_b_status, v_station_b_is_active, v_total_bins, v_null_bins, v_fake_sensor_readings, v_old_index_exists, v_old_constraint_exists, v_is_valid, v_col1, v_col2;
    END IF;
END $$;
-- ==============================================================================
-- END OF SCRIPT: round20_3_verify.sql (Round 20.7 Revision)
-- ==============================================================================
