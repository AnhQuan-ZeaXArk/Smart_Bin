-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "binCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "capacity" INTEGER NOT NULL,
    "currentFillLevel" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeen" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Bin" ("binCode", "capacity", "createdAt", "currentFillLevel", "id", "lastSeen", "latitude", "location", "longitude", "name", "status", "updatedAt") SELECT "binCode", "capacity", "createdAt", "currentFillLevel", "id", "lastSeen", "latitude", "location", "longitude", "name", "status", "updatedAt" FROM "Bin";
DROP TABLE "Bin";
ALTER TABLE "new_Bin" RENAME TO "Bin";
CREATE UNIQUE INDEX "Bin_binCode_key" ON "Bin"("binCode");
CREATE INDEX "Bin_isActive_status_idx" ON "Bin"("isActive", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
