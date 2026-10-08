CREATE TABLE "ProductAuditLog" (
 "id" TEXT NOT NULL, "productId" TEXT NOT NULL, "countryId" TEXT NOT NULL,
 "actorId" TEXT, "actorName" TEXT, "action" TEXT NOT NULL, "changes" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ProductAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductAuditLog_productId_countryId_createdAt_idx" ON "ProductAuditLog"("productId", "countryId", "createdAt");
CREATE INDEX "ProductAuditLog_countryId_createdAt_idx" ON "ProductAuditLog"("countryId", "createdAt");
