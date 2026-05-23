-- Prix directs par grade, utilisables pays par pays.
CREATE TABLE IF NOT EXISTS "ProductGradePrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "prixFcfa" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductGradePrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductGradePrice_countryId_productId_grade_key"
ON "ProductGradePrice"("countryId", "productId", "grade");

CREATE INDEX IF NOT EXISTS "ProductGradePrice_productId_idx"
ON "ProductGradePrice"("productId");

CREATE INDEX IF NOT EXISTS "ProductGradePrice_countryId_idx"
ON "ProductGradePrice"("countryId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductGradePrice_productId_fkey'
  ) THEN
    ALTER TABLE "ProductGradePrice"
    ADD CONSTRAINT "ProductGradePrice_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductGradePrice_countryId_fkey'
  ) THEN
    ALTER TABLE "ProductGradePrice"
    ADD CONSTRAINT "ProductGradePrice_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
