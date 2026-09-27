-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('RASPBERRY_PI', 'ULTRASONIC_SENSOR', 'CAMERA', 'MQTT');

-- CreateEnum
CREATE TYPE "DeviceStatusEnum" AS ENUM ('ONLINE', 'WARNING', 'OFFLINE');

-- CreateTable
CREATE TABLE "DeviceStatus" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "status" "DeviceStatusEnum" NOT NULL DEFAULT 'OFFLINE',
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeat" TIMESTAMP(3),
    "firmwareVersion" TEXT,
    "ipAddress" TEXT,
    "uptime" INTEGER,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceStatus_deviceId_key" ON "DeviceStatus"("deviceId");
CREATE INDEX "DeviceStatus_deviceType_status_idx" ON "DeviceStatus"("deviceType", "status");
CREATE INDEX "DeviceStatus_lastSeen_idx" ON "DeviceStatus"("lastSeen");

-- Add displayName to User and migrate names from Employee
ALTER TABLE "User" ADD COLUMN "displayName" TEXT;

UPDATE "User"
SET "displayName" = "Employee"."fullName"
FROM "Employee"
WHERE "User"."employeeId" = "Employee"."id";

UPDATE "User"
SET "displayName" = "username"
WHERE "displayName" IS NULL;

-- Remove foreign key and employeeId from User
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_employeeId_fkey";
DROP INDEX IF EXISTS "User_employeeId_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "employeeId";

-- Update CollectionRecord
ALTER TABLE "CollectionRecord" ADD COLUMN "collectedBy" TEXT;
ALTER TABLE "CollectionRecord" ADD COLUMN "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "CollectionRecord"
SET "collectedBy" = "Employee"."fullName"
FROM "Employee"
WHERE "CollectionRecord"."employeeId" = "Employee"."id";

UPDATE "CollectionRecord"
SET "collectedAt" = "startTime"
WHERE "startTime" IS NOT NULL;

ALTER TABLE "CollectionRecord" DROP CONSTRAINT IF EXISTS "CollectionRecord_employeeId_fkey";
ALTER TABLE "CollectionRecord" DROP COLUMN IF EXISTS "employeeId";

CREATE INDEX "CollectionRecord_binId_collectedAt_idx" ON "CollectionRecord"("binId", "collectedAt");

-- Clean up obsolete alerts
DELETE FROM "Alert" WHERE "type"::text = 'NFC_ACCESS_DENIED';

-- Drop obsolete tables and constraints
DROP TABLE IF EXISTS "AccessLog";
DROP TABLE IF EXISTS "NfcCard";
DROP TABLE IF EXISTS "Employee";

-- Drop obsolete enums
DROP TYPE IF EXISTS "NfcCardStatus";
DROP TYPE IF EXISTS "EmployeeStatus";
DROP TYPE IF EXISTS "AccessResult";
DROP TYPE IF EXISTS "AccessReason";
