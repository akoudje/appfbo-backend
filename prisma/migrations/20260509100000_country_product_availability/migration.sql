CREATE TABLE "CountryProduct" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "countryId" TEXT NOT NULL,
  "prixBaseFcfa" INTEGER NOT NULL,
  "stockQty" INTEGER NOT NULL DEFAULT 0,
  "actif" BOOLEAN NOT NULL DEFAULT true,
  "maxQtyPerOrder" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CountryProduct_pkey" PRIMARY KEY ("id")
);

INSERT INTO "CountryProduct" (
  "id",
  "productId",
  "countryId",
  "prixBaseFcfa",
  "stockQty",
  "actif",
  "maxQtyPerOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  concat('cp_', md5(random()::text || clock_timestamp()::text || "id")),
  "id",
  "countryId",
  "prixBaseFcfa",
  "stockQty",
  "actif",
  "maxQtyPerOrder",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product"
WHERE "countryId" IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "StockMovement" ADD COLUMN "countryId" TEXT;

UPDATE "StockMovement" sm
SET "countryId" = p."countryId"
FROM "Product" p
WHERE sm."productId" = p."id" AND sm."countryId" IS NULL;

CREATE UNIQUE INDEX "CountryProduct_countryId_productId_key" ON "CountryProduct"("countryId", "productId");
CREATE INDEX "CountryProduct_productId_idx" ON "CountryProduct"("productId");
CREATE INDEX "CountryProduct_countryId_idx" ON "CountryProduct"("countryId");
CREATE INDEX "CountryProduct_actif_idx" ON "CountryProduct"("actif");
CREATE INDEX "StockMovement_countryId_createdAt_idx" ON "StockMovement"("countryId", "createdAt");

ALTER TABLE "CountryProduct"
  ADD CONSTRAINT "CountryProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CountryProduct"
  ADD CONSTRAINT "CountryProduct_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
