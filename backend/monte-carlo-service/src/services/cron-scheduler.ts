import cron from "node-cron";
import axios from "axios";
import { getPrismaClient } from "../db";
import { Logger } from "../utils/logger";
import {
  createSimulationJob,
  executeSimulationJob,
} from "./job-manager";

let scheduledJob: cron.ScheduledTask | null = null;

interface FundedAccount {
  id: string;
  userId: string;
  status: string;
}

export async function startDailySimulationScheduler(
  coreServiceUrl: string,
  rayServeUrl: string,
  logger: Logger
): Promise<void> {
  const prisma = getPrismaClient();

  // Schedule cron job: 0 2 * * * (2 AM daily)
  scheduledJob = cron.schedule("0 2 * * *", async () => {
    try {
      logger.info("Daily simulation scheduler triggered");

      // Query Core Service for active funded accounts
      const response = await axios.get<FundedAccount[]>(
        `${coreServiceUrl}/funded-accounts?status=active`
      );
      const fundedAccounts = response.data;

      logger.info("Fetched active funded accounts", {
        count: fundedAccounts.length,
      });

      for (const account of fundedAccounts) {
        try {
          // Check if simulation ran in last 24 hours
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

          const recentSimulation = await prisma.simulationJob.findFirst({
            where: {
              fundedAccountId: account.id,
              status: "completed",
              completedAt: {
                gte: twentyFourHoursAgo,
              },
            },
          });

          if (recentSimulation) {
            logger.info("Recent simulation found, skipping", {
              fundedAccountId: account.id,
              lastSimulation: recentSimulation.completedAt,
            });
            continue;
          }

          logger.info("Daily simulation triggered for funded account", {
            fundedAccountId: account.id,
          });

          // Create and execute simulation job
          const jobId = await createSimulationJob(
            undefined,
            account.id,
            coreServiceUrl,
            logger
          );

          // Execute asynchronously
          executeSimulationJob(jobId, rayServeUrl, logger).catch((error) => {
            logger.error("Daily simulation execution failed", {
              fundedAccountId: account.id,
              jobId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        } catch (error) {
          logger.error("Failed to process funded account", {
            fundedAccountId: account.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.error("Daily simulation scheduler failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  logger.info("Daily simulation scheduler started (2 AM daily)");
}

export function stopScheduler(logger: Logger): void {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    logger.info("Cron scheduler stopped");
  }
}
