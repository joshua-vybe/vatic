-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "SimulationJob" (
    "id" STRING NOT NULL,
    "assessmentId" STRING,
    "fundedAccountId" STRING,
    "status" "SimulationStatus" NOT NULL DEFAULT 'pending',
    "inputData" JSONB NOT NULL,
    "result" JSONB,
    "error" STRING,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SimulationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulationJob_assessmentId_status_idx" ON "SimulationJob"("assessmentId", "status");

-- CreateIndex
CREATE INDEX "SimulationJob_fundedAccountId_status_idx" ON "SimulationJob"("fundedAccountId", "status");

-- CreateIndex
CREATE INDEX "SimulationJob_status_createdAt_idx" ON "SimulationJob"("status", "createdAt");
