-- CreateEnum
CREATE TYPE "MemorialTributeStatus" AS ENUM ('PENDING', 'PUBLISHED', 'ARCHIVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Memorial" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "subtitle" TEXT,
    "birthDate" TIMESTAMP(3),
    "deathDate" TIMESTAMP(3),
    "coverImageUrl" TEXT,
    "biography" TEXT,
    "thankYouMessage" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memorial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemorialTribute" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "relationship" TEXT,
    "authorEmail" TEXT,
    "authorPhone" TEXT,
    "message" TEXT NOT NULL,
    "photoUrl" TEXT,
    "candleLit" BOOLEAN NOT NULL DEFAULT false,
    "status" "MemorialTributeStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemorialTribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Memorial_countryId_slug_key" ON "Memorial"("countryId", "slug");

-- CreateIndex
CREATE INDEX "Memorial_countryId_published_idx" ON "Memorial"("countryId", "published");

-- CreateIndex
CREATE INDEX "MemorialTribute_countryId_status_createdAt_idx" ON "MemorialTribute"("countryId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MemorialTribute_memorialId_status_createdAt_idx" ON "MemorialTribute"("memorialId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MemorialTribute_reviewedById_idx" ON "MemorialTribute"("reviewedById");

-- AddForeignKey
ALTER TABLE "Memorial" ADD CONSTRAINT "Memorial_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorialTribute" ADD CONSTRAINT "MemorialTribute_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorialTribute" ADD CONSTRAINT "MemorialTribute_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorialTribute" ADD CONSTRAINT "MemorialTribute_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
