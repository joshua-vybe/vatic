import { getPrismaClient } from '../db';
import { getRedisClient } from '../utils/redis';
import { createLogger } from '../utils/logger';
import { AssessmentState } from '../utils/assessment-state';

const logger = createLogger('persistence-worker');

let persistenceInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export async function startPersistenceWorker(): Promise<void> {
  if (isRunning) {
    logger.warn('Persistence worker already running');
    return;
  }

  isRunning = true;
  logger.info('Starting persistence worker');

  persistenceInterval = setInterval(async () => {
    await persistAssessmentStates();
  }, 5000); // 5-second interval
}

export async function stopPersistenceWorker(): Promise<void> {
  if (persistenceInterval) {
    clearInterval(persistenceInterval);
    persistenceInterval = null;
    isRunning = false;
    logger.info('Persistence worker stopped');
  }
}

async function persistAssessmentStates(): Promise<void> {
  const correlationId = `persist-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { correlationId });
      return;
    }

    const prisma = getPrismaClient();

    // Scan for all active assessment keys
    let cursor = '0';
    let assessmentIds: string[] = [];
    let recordsUpdated = 0;
    let errors = 0;

    do {
      const result = await redis.scan(cursor, 'MATCH', 'assessment:*:state', 'COUNT', '100');
      cursor = result[0];
      const keys = result[1];

      for (const key of keys) {
        // Extract assessment ID from key format: assessment:{id}:state
        const match = key.match(/^assessment:(.+):state$/);
        if (match) {
          assessmentIds.push(match[1]);
        }
      }
    } while (cursor !== '0');

    logger.debug('Found active assessments', {
      count: assessmentIds.length,
      correlationId,
    });

    // Persist each assessment's state
    for (const assessmentId of assessmentIds) {
      try {
        const stateJson = await redis.get(`assessment:${assessmentId}:state`);
        if (!stateJson) {
          logger.debug('Assessment state not found in Redis', { assessmentId, correlationId });
          continue;
        }

        const state = JSON.parse(stateJson) as AssessmentState;

        // Fetch virtual account ID for this assessment
        const virtualAccount = await prisma.virtualAccount.findUnique({
          where: { assessmentId },
        });

        if (!virtualAccount) {
          logger.debug('Virtual account not found for assessment', { assessmentId, correlationId });
          continue;
        }

        // Update VirtualAccount record with correct where clause
        await prisma.virtualAccount.update({
          where: { id: virtualAccount.id },
          data: {
            currentBalance: state.currentBalance,
            peakBalance: state.peakBalance,
            realizedPnl: state.realizedPnl,
            unrealizedPnl: state.unrealizedPnl,
            updatedAt: new Date(),
          },
        });

        logger.debug('Virtual account persisted', {
          assessmentId,
          virtualAccountId: virtualAccount.id,
          currentBalance: state.currentBalance,
          correlationId,
        });

        // Update Position records with current prices and unrealized P&L
        for (const position of state.positions) {
          await prisma.position.update({
            where: { id: position.id },
            data: {
              currentPrice: position.currentPrice,
              unrealizedPnl: position.unrealizedPnl,
              updatedAt: new Date(),
            },
          });
        }

        recordsUpdated++;
      } catch (error) {
        logger.error('Failed to persist assessment state', {
          assessmentId,
          error: String(error),
          correlationId,
        });
        errors++;
      }
    }

    logger.debug('Persistence cycle completed', {
      assessmentsProcessed: assessmentIds.length,
      recordsUpdated,
      errors,
      correlationId,
    });
  } catch (error) {
    logger.error('Persistence worker cycle failed', {
      error: String(error),
      correlationId,
    });
  }
}
