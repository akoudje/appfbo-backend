DO $$
BEGIN
  ALTER TYPE "OrderMessageChannel" ADD VALUE IF NOT EXISTS 'SMS';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "OrderMessageChannel" ADD VALUE IF NOT EXISTS 'EMAIL';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

