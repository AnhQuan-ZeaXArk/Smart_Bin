/*
  Warnings:

  - Added the required column `reason` to the `AccessLog` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT,
    "nfcCardId" TEXT,
    "binId" TEXT,
    "nfcUid" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'UNKNOWN_CARD',
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AccessLog_nfcCardId_fkey" FOREIGN KEY ("nfcCardId") REFERENCES "NfcCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AccessLog_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AccessLog" ("action", "binId", "employeeId", "id", "nfcUid", "result", "reason", "timestamp") SELECT "action", "binId", "employeeId", "id", "nfcUid", "result", 'UNKNOWN_CARD', "timestamp" FROM "AccessLog";
DROP TABLE "AccessLog";
ALTER TABLE "new_AccessLog" RENAME TO "AccessLog";
CREATE INDEX "AccessLog_employeeId_timestamp_idx" ON "AccessLog"("employeeId", "timestamp");
CREATE INDEX "AccessLog_nfcCardId_timestamp_idx" ON "AccessLog"("nfcCardId", "timestamp");
CREATE INDEX "AccessLog_binId_timestamp_idx" ON "AccessLog"("binId", "timestamp");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
