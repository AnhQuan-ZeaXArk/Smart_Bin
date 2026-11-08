-- Migration 000000000003_multi_station_expand (Phase 1 Expand Phase)
-- Description: Expand schema with Station, StationWatermark, TelemetryIdempotencyLedger, and nullable stationId on Bin.

-- 1. CreateEnum StationStatus
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StationStatus') THEN
        CREATE TYPE "StationStatus" AS ENUM ('ONLINE', 'WARNING', 'OFFLINE', 'MAINTENANCE');
    END IF;
END $$;

-- 2. CreateTable Station
CREATE TABLE IF NOT EXISTS "public"."Station" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StationStatus" NOT NULL DEFAULT 'OFFLINE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on Station.code
CREATE UNIQUE INDEX IF NOT EXISTS "Station_code_key" ON "public"."Station"("code");

-- 3. AlterTable Bin (Add nullable stationId and installed)
ALTER TABLE "public"."Bin" ADD COLUMN IF NOT EXISTS "stationId" TEXT;
ALTER TABLE "public"."Bin" ADD COLUMN IF NOT EXISTS "installed" BOOLEAN NOT NULL DEFAULT true;

-- 4. AddForeignKey Bin_stationId_fkey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Bin_stationId_fkey') THEN
        ALTER TABLE "public"."Bin" ADD CONSTRAINT "Bin_stationId_fkey" 
        FOREIGN KEY ("stationId") REFERENCES "public"."Station"("id") 
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- 5. AlterTable SensorReading (Add isLate)
ALTER TABLE "public"."SensorReading" ADD COLUMN IF NOT EXISTS "isLate" BOOLEAN NOT NULL DEFAULT false;

-- 6. CreateTable StationWatermark
CREATE TABLE IF NOT EXISTS "public"."StationWatermark" (
    "id" TEXT NOT NULL,
    "stationCode" TEXT NOT NULL,
    "binCode" TEXT NOT NULL,
    "bootCount" BIGINT NOT NULL DEFAULT 0,
    "bootId" TEXT NOT NULL,
    "lastSampleSeq" INTEGER NOT NULL DEFAULT 0,
    "lastPayloadHash" VARCHAR(64) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationWatermark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StationWatermark_stationCode_binCode_key" ON "public"."StationWatermark"("stationCode", "binCode");
CREATE INDEX IF NOT EXISTS "StationWatermark_stationCode_updatedAt_idx" ON "public"."StationWatermark"("stationCode", "updatedAt");

-- 7. CreateTable TelemetryIdempotencyLedger
CREATE TABLE IF NOT EXISTS "public"."TelemetryIdempotencyLedger" (
    "id" TEXT NOT NULL,
    "stationCode" TEXT NOT NULL,
    "bootId" TEXT NOT NULL,
    "sampleSeq" INTEGER NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryIdempotencyLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TelemetryIdempotencyLedger_stationCode_bootId_sampleSeq_key" ON "public"."TelemetryIdempotencyLedger"("stationCode", "bootId", "sampleSeq");
CREATE INDEX IF NOT EXISTS "TelemetryIdempotencyLedger_receivedAt_idx" ON "public"."TelemetryIdempotencyLedger"("receivedAt");

-- 8. CreateTable _migration_provenance
CREATE TABLE IF NOT EXISTS "public"."_migration_provenance" (
    "id" SERIAL PRIMARY KEY,
    "phase" VARCHAR(20) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "target" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'APPLIED',
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolled_back_at" TIMESTAMP(3),
    "notes" TEXT
);

-- 9. Seed Station A default record
INSERT INTO "public"."Station" ("id", "code", "name", "status", "isActive", "location")
VALUES ('station_a_canonical_id', 'STATION_A', 'Trạm Thu gom Trung tâm A', 'ONLINE', true, 'Khuôn viên chính')
ON CONFLICT ("code") DO NOTHING;

-- 10. Record migration provenance
INSERT INTO "public"."_migration_provenance" ("phase", "action", "target", "status", "notes")
VALUES ('PHASE_1', 'EXPAND_SCHEMA', 'Station, Bin.stationId, Bin.installed, SensorReading.isLate, Watermark, Ledger', 'APPLIED', 'Expand multi-station schema');

