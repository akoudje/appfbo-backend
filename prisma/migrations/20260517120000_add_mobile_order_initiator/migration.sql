ALTER TABLE "Preorder"
ADD COLUMN IF NOT EXISTS "placedByFboNumero" TEXT,
ADD COLUMN IF NOT EXISTS "placedByFboName" TEXT,
ADD COLUMN IF NOT EXISTS "placedByFboPhone" TEXT,
ADD COLUMN IF NOT EXISTS "placedByFboEmail" TEXT,
ADD COLUMN IF NOT EXISTS "placedByHomeCountryCode" TEXT;

CREATE INDEX IF NOT EXISTS "Preorder_placedByFboNumero_idx"
ON "Preorder"("placedByFboNumero");
