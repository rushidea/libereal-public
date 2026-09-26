-- CreateTable
CREATE TABLE "WechatMiniLoginChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "providerAccountId" TEXT,
  "userId" TEXT,
  "loginToken" TEXT,
  "oauthName" TEXT,
  "oauthImage" TEXT,
  "oauthSex" INTEGER,
  "expiresAt" DATETIME NOT NULL,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "WechatMiniLoginChallenge_loginToken_key" ON "WechatMiniLoginChallenge"("loginToken");
CREATE INDEX "WechatMiniLoginChallenge_status_idx" ON "WechatMiniLoginChallenge"("status");
CREATE INDEX "WechatMiniLoginChallenge_expiresAt_idx" ON "WechatMiniLoginChallenge"("expiresAt");
CREATE INDEX "WechatMiniLoginChallenge_providerAccountId_idx" ON "WechatMiniLoginChallenge"("providerAccountId");
CREATE INDEX "WechatMiniLoginChallenge_userId_idx" ON "WechatMiniLoginChallenge"("userId");
