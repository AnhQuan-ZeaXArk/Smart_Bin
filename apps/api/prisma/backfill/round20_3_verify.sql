-- ==============================================================================
-- SMARTBIN MULTI-STATION: CONTROLLED VERIFICATION SCRIPT (ROUND 20.3)
-- Target Database: PostgreSQL (Production Render: smartbin_ppmz)
-- Mode: READ-ONLY (No writes, no modifications)
-- Scope:
--   Verifies data integrity, counts, constraints, and invariants after repair.
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
-- 4. BẢNG KIỂM TRA CHỈ MỤC & RÀNG BUỘC DUY NHẤT
-- ------------------------------------------------------------------------------
SELECT 
    indexname, 
    indexdef
FROM pg_indexes
WHERE tablename = 'Bin' AND indexname IN ('Bin_binCode_key', 'Bin_stationId_binCode_key', 'Bin_binCode_idx');

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
    v_station_a_bins INTEGER;
    v_station_b_bins INTEGER;
    v_total_bins INTEGER;
    v_null_bins INTEGER;
    v_installed_bins INTEGER;
    v_uninstalled_bins INTEGER;
    v_fake_sensor_readings INTEGER;
BEGIN
    SELECT count(*) INTO v_stations_count FROM "public"."Station";
    SELECT count(*) INTO v_has_station_a FROM "public"."Station" WHERE "code" = 'STATION_A';
    SELECT count(*) INTO v_has_station_b FROM "public"."Station" WHERE "code" = 'STATION_B';
    SELECT count(*) INTO v_station_a_bins FROM "public"."Bin" WHERE "stationId" = 'station_a_canonical_id';
    SELECT count(*) INTO v_station_b_bins FROM "public"."Bin" WHERE "stationId" = 'station_b_canonical_id';
    SELECT count(*) INTO v_total_bins FROM "public"."Bin";
    SELECT count(*) INTO v_null_bins FROM "public"."Bin" WHERE "stationId" IS NULL;
    SELECT count(*) INTO v_installed_bins FROM "public"."Bin" WHERE "installed" = true;
    SELECT count(*) INTO v_uninstalled_bins FROM "public"."Bin" WHERE "installed" = false;
    SELECT count(*) INTO v_fake_sensor_readings FROM "public"."SensorReading" 
    WHERE "binId" IN (SELECT "id" FROM "public"."Bin" WHERE "stationId" = 'station_b_canonical_id');

    IF v_stations_count = 2 AND
       v_has_station_a = 1 AND
       v_has_station_b = 1 AND
       v_station_a_bins = 3 AND
       v_station_b_bins = 3 AND
       v_total_bins = 6 AND
       v_null_bins = 0 AND
       v_installed_bins = 4 AND
       v_uninstalled_bins = 2 AND
       v_fake_sensor_readings = 0 THEN
        RAISE NOTICE '>>> [PASS] ALL ROUND 20.3 VERIFICATION CRITERIA MET PERFECTLY! <<<';
    ELSE
        RAISE EXCEPTION '>>> [FAIL] ONE OR MORE CRITERIA NOT MET! Check results above. <<<';
    END IF;
END $$;
-- ==============================================================================
-- END OF SCRIPT: round20_3_verify.sql
-- ==============================================================================

