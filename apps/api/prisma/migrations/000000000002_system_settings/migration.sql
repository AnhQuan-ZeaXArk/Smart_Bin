-- CreateTable
CREATE TABLE IF NOT EXISTS "system_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "warning_threshold" INTEGER NOT NULL DEFAULT 50,
    "near_full_threshold" INTEGER NOT NULL DEFAULT 70,
    "full_threshold" INTEGER NOT NULL DEFAULT 90,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- Seed initial default threshold settings if not exists
INSERT INTO "system_settings" ("id", "warning_threshold", "near_full_threshold", "full_threshold", "created_at", "updated_at")
VALUES ('default', 50, 70, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

