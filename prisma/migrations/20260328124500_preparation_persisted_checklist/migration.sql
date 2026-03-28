CREATE TABLE "PreparationChecklistItem" (
    "id" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "preorderItemId" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "checkedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreparationAnomaly" (
    "id" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "preorderItemId" TEXT,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationAnomaly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PreparationChecklistItem_preorderId_preorderItemId_key" ON "PreparationChecklistItem"("preorderId", "preorderItemId");
CREATE INDEX "PreparationChecklistItem_preorderId_checked_idx" ON "PreparationChecklistItem"("preorderId", "checked");
CREATE INDEX "PreparationChecklistItem_checkedById_idx" ON "PreparationChecklistItem"("checkedById");

CREATE INDEX "PreparationAnomaly_preorderId_createdAt_idx" ON "PreparationAnomaly"("preorderId", "createdAt");
CREATE INDEX "PreparationAnomaly_preorderId_resolvedAt_idx" ON "PreparationAnomaly"("preorderId", "resolvedAt");
CREATE INDEX "PreparationAnomaly_preorderItemId_idx" ON "PreparationAnomaly"("preorderItemId");
CREATE INDEX "PreparationAnomaly_createdById_idx" ON "PreparationAnomaly"("createdById");
CREATE INDEX "PreparationAnomaly_resolvedById_idx" ON "PreparationAnomaly"("resolvedById");

ALTER TABLE "PreparationChecklistItem"
ADD CONSTRAINT "PreparationChecklistItem_preorderId_fkey"
FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PreparationChecklistItem"
ADD CONSTRAINT "PreparationChecklistItem_preorderItemId_fkey"
FOREIGN KEY ("preorderItemId") REFERENCES "PreorderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PreparationChecklistItem"
ADD CONSTRAINT "PreparationChecklistItem_checkedById_fkey"
FOREIGN KEY ("checkedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PreparationAnomaly"
ADD CONSTRAINT "PreparationAnomaly_preorderId_fkey"
FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PreparationAnomaly"
ADD CONSTRAINT "PreparationAnomaly_preorderItemId_fkey"
FOREIGN KEY ("preorderItemId") REFERENCES "PreorderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PreparationAnomaly"
ADD CONSTRAINT "PreparationAnomaly_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PreparationAnomaly"
ADD CONSTRAINT "PreparationAnomaly_resolvedById_fkey"
FOREIGN KEY ("resolvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
