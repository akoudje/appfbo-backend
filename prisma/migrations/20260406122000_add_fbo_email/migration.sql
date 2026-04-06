-- Add email to Fbo profile and snapshot on Preorder
ALTER TABLE "Fbo"
ADD COLUMN IF NOT EXISTS "email" TEXT;

ALTER TABLE "Preorder"
ADD COLUMN IF NOT EXISTS "fboEmail" TEXT;

CREATE INDEX IF NOT EXISTS "Fbo_email_idx" ON "Fbo"("email");
