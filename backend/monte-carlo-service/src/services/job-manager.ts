import { getPrismaClient } from "../db";
import { Logger } from "../utils/logger";
import { publishEvent } from "../utils/kafka";
import {
  callRayServeSimulation,
  SimulationInput,
  SimulationResult,
} from "../clients/ray-serve";
import {
  fetchAssessmentData,
  fetchTradeHistory,
  fetchFundedAccountData,
  fetchTradeHistoryForFundedAccount,
} from "../clients/core-service";

export async function createSimulationJob(
  assessmentId: string | undefined,
  fundedAccountId: string | undefined,
  coreServiceUrl: string,
  logger: Logger
): Promise<string> {
  const prisma = getPrismaClient();

  try {
    let tradeHistory: any[] = [];
    let pnlData = {
      balance: 0,
      peak: 0,
      realized: 0,
      unrealized: 0,
    };

    if (assessmentId) {
      const assessment = await fetchAssessmentData(
        assessmentId,
        coreServiceUrl,
        logger
      );
      tradeHistory = await fetchTradeHistory(
        assessmentId,
        coreServiceUrl,
        logger
      );
      pnlData = {
        balance: assessment.virtualAccount.balance,
        peak: assessment.virtualAccount.peak,
        realized: 0,
        unrealized: assessment.virtualAccount.pnl,
      };
    } else if (fundedAccountId) {
      const fundedAccount = await fetchFundedAccountData(
        fundedAccountId,
        coreServiceUrl,
        logger
      );
      tradeHistory = await fetchTradeHistoryForFundedAccount(
        fundedAccountId,
        coreServiceUrl,
        logger
      );
      pnlData = {
        balance: fundedAccount.virtualAccount.balance,
        peak: fundedAccount.virtualAccount.peak,
        realized: 0,
        unrealized: fundedAccount.virtualAccount.pnl,
      };
    }

    const inputData: SimulationInput = {
      tradeHistory,
      pnlData,
    };

    const job = await prisma.simulationJob.create({
      data: {
        assessmentId,
        fundedAccountId,
        status: "pending",
        inputData,
      },
    });

    logger.info("Simulation job created", {
      jobId: job.id,
      assessmentId,
      fundedAccountId,
    });

    return job.id;
  } catch (error) {
    logger.error("Failed to create simulation job", {
      assessmentId,
      fundedAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function executeSimulationJob(
  jobId: string,
  rayServeUrl: string,
  logger: Logger
): Promise<void> {
  const prisma = getPrismaClient();

  try {
    let job = await prisma.simulationJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Update status to running
    job = await prisma.simulationJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        startedAt: new Date(),
      },
    });

    logger.info("Simulation job started", { jobId });

    // Publish simulation-started event
    await publishEvent(
      "montecarlo.simulation-started",
      {
        jobId,
        assessmentId: job.assessmentId,
        fundedAccountId: job.fundedAccountId,
        timestamp: new Date().toISOString(),
      },
      logger
    );

    // Call Ray Serve
    const result = await callRayServeSimulation(
      job.inputData as SimulationInput,
      rayServeUrl,
      logger
    );

    // Update job with result
    job = await prisma.simulationJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        result,
        completedAt: new Date(),
      },
    });

    logger.info("Simulation job completed", {
      jobId,
      pathsSimulated: result.pathsSimulated,
    });

    // Publish completion event
    await publishEvent(
      "montecarlo.simulation-completed",
      {
        jobId,
        assessmentId: job.assessmentId,
        fundedAccountId: job.fundedAccountId,
        result,
        timestamp: new Date().toISOString(),
      },
      logger
    );
  } catch (error) {
    logger.error("Simulation job failed", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });

    await prisma.simulationJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });

    throw error;
  }
}

export async function getSimulationResult(
  jobId: string,
  logger: Logger
): Promise<any> {
  const prisma = getPrismaClient();

  try {
    const job = await prisma.simulationJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    return job;
  } catch (error) {
    logger.error("Failed to get simulation result", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function listSimulationJobs(
  assessmentId?: string,
  status?: string,
  logger?: Logger
): Promise<any[]> {
  const prisma = getPrismaClient();

  try {
    const jobs = await prisma.simulationJob.findMany({
      where: {
        ...(assessmentId && { assessmentId }),
        ...(status && { status: status as any }),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return jobs;
  } catch (error) {
    logger?.error("Failed to list simulation jobs", {
      assessmentId,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
