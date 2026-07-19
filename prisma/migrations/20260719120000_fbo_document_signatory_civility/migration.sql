-- CreateEnum
CREATE TYPE "SignatoryCivility" AS ENUM ('M', 'MME');

-- AlterTable
ALTER TABLE "FboDocument" ADD COLUMN "signatoryCivility" "SignatoryCivility" NOT NULL DEFAULT 'MME';
