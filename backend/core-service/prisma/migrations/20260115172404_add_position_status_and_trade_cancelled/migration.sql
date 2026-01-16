-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('open', 'closed', 'cancelled');

-- AlterTable
ALTER TABLE "positions" ADD COLUMN "status" "PositionStatus" NOT NULL DEFAULT 'open';

-- AlterTable
ALTER TABLE "trades" ADD COLUMN "cancelled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill status for existing positions
UPDATE "positions" SET "status" = 'closed' WHERE "closed_at" IS NOT NULL;
UPDATE "positions" SET "status" = 'open' WHERE "closed_at" IS NULL;
