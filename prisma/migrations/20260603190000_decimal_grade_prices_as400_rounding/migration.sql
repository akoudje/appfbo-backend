ALTER TABLE "ProductGradePrice"
ALTER COLUMN "prixFcfa" TYPE DECIMAL(12, 4)
USING "prixFcfa"::DECIMAL(12, 4);

ALTER TABLE "PreorderItem"
ALTER COLUMN "prixUnitaireFcfa" TYPE DECIMAL(12, 4)
USING "prixUnitaireFcfa"::DECIMAL(12, 4);
