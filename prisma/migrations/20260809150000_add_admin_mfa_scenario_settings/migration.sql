CREATE TABLE "AdminMfaSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarios" TEXT NOT NULL,
    "updatedByEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
