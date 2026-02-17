/*
  Warnings:

  - The values [ASSOCIATE,ASSISTANT_SUPERVISOR,SUPERVISOR,ASSISTANT_MANAGER,SENIOR_MANAGER,DIRECTOR,SENIOR_DIRECTOR,EXECUTIVE,SAPPHIRE,DIAMOND_SAPPHIRE,DIAMOND,SOARING_MANAGER] on the enum `Grade` will be removed. If these variants are still used in the database, this will fail.
  - The values [MTN_MONEY,MOOV_MONEY,CASH,BANK_TRANSFER] on the enum `PaymentMode` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Grade_new" AS ENUM ('ANIMATEUR_ADJOINT', 'ANIMATEUR', 'MANAGER_ADJOINT', 'MANAGER', 'CLIENT_PRIVILEGIE');
ALTER TABLE "Fbo" ALTER COLUMN "grade" TYPE "Grade_new" USING ("grade"::text::"Grade_new");
ALTER TABLE "GradeDiscount" ALTER COLUMN "grade" TYPE "Grade_new" USING ("grade"::text::"Grade_new");
ALTER TABLE "Preorder" ALTER COLUMN "fboGrade" TYPE "Grade_new" USING ("fboGrade"::text::"Grade_new");
ALTER TYPE "Grade" RENAME TO "Grade_old";
ALTER TYPE "Grade_new" RENAME TO "Grade";
DROP TYPE "public"."Grade_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMode_new" AS ENUM ('WAVE', 'ORANGE_MONEY', 'ESPECES', 'OTHER');
ALTER TABLE "Preorder" ALTER COLUMN "paymentMode" TYPE "PaymentMode_new" USING ("paymentMode"::text::"PaymentMode_new");
ALTER TYPE "PaymentMode" RENAME TO "PaymentMode_old";
ALTER TYPE "PaymentMode_new" RENAME TO "PaymentMode";
DROP TYPE "public"."PaymentMode_old";
COMMIT;
