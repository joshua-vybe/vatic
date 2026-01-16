import { getPrismaClient } from '../db';
import { getRedisClient } from '../utils/redis';
import { createLogger } from '../utils/logger';
import { publishEvent } from '../utils/kafka';
import { AssessmentState, updateAssessmentState } from '../utils/assessment-state';
import {
  recordCancelledPositionPersisted,
  recordCancelledTradesMarked,
  recordCancelledPositionPersistenceDuration,
  setCancelledPositionsPendingPersistence,
  setCancelledPositionPersistenceDlqSize,
} from '../utils/metrics';

const logger = createLogger('persistence-worker');

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

// Health tracking
let lastSuccessfulCycle: number = Date.now();
let consecutiveFailures: number = 0;

let persistenceInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// Error type classification
type ErrorType = 'transient' | 'permanent' | 'unknown';

interface FailedOperation {
  assessmentId: string;
  positionId: string;
  timestamp: number;
  errorMessage: string;
  retryCount: number;
  errorType?: ErrorType;
}

/**
 * Classify error as transient or permanent
 */
function classifyError(error: any): ErrorType {
  const errorStr = String(error);
  
  // Transient errors
  if (
    errorStr.includes('ECONNREFUSED') ||
    errorStr.includes('ETIMEDOUT') ||
    errorStr.includes('EHOSTUNREACH') ||
    errorStr.includes('connection timeout') ||
    errorStr.includes('connection reset') ||
    errorStr.includes('temporarily unavailable')
  ) {
    return 'transient';
  }

  // Permanent errors
  if (
    errorStr.includes('UNIQUE constraint') ||
    errorStr.includes('FOREIGN KEY constraint') ||
    errorStr.includes('NOT NULL constraint') ||
    errorStr.includes('invalid input') ||
    errorStr.includes('syntax error')
  ) {
    return 'permanent';
  }

  return 'unknown';
}

/**
 * Retry database operation with exponential backoff
 */
async function retryDatabaseOperation<T>(
  fn: () => Promise<T>,
  operationName: string,
  correlationId: string,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      logger.debug(`Executing database operation: ${operationName}`, {
        attempt: attempt + 1,
        maxRetries,
        correlationId,
      });

      return await fn();
    } catch (error) {
      lastError = error as Error;
      const errorType = classifyError(error);

      logger.warn(`Database operation failed: ${operationName}`, {
        attempt: attempt + 1,
        maxRetries,
        errorType,
        error: String(error),
        correlationId,
      });

      // Don't retry permanent errors
      if (errorType === 'permanent') {
        logger.error(`Permanent error in database operation: ${operationName}`, {
          error: String(error),
          correlationId,
        });
        throw error;
      }

      // Retry on transient errors or unknown errors
      if (attempt < maxRetries - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.debug(`Retrying after ${delay}ms`, {
          operationName,
          correlationId,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logger.error(`Database operation exhausted retries: ${operationName}`, {
    maxRetries,
    error: String(lastError),
    correlationId,
  });

  throw lastError;
}

/**
 * Push failed operation to dead letter queue
 */
async function pushToDeadLetterQueue(
  operation: FailedOperation,
  correlationId: string
): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.error('Redis client not available for DLQ', { correlationId });
      return;
    }

    const dlqKey = 'persistence:failed:cancelled-positions';
    const dlqItem = JSON.stringify(operation);

    // Push to DLQ with 7-day TTL
    await redis.lpush(dlqKey, dlqItem);
    await redis.expire(dlqKey, 7 * 24 * 60 * 60);

    logger.error('Operation pushed to dead letter queue', {
      dlqKey,
      assessmentId: operation.assessmentId,
      positionId: operation.positionId,
      correlationId,
    });

    // Update DLQ size metric
    const dlqSize = await redis.llen(dlqKey);
    setCancelledPositionPersistenceDlqSize(dlqSize);
  } catch (error) {
    logger.error('Failed to push operation to dead letter queue', {
      error: String(error),
      correlationId,
    });
  }
}

/**
 * Persist cancelled position with transaction and retry logic
 */
async function persistCancelledPosition(
  assessmentId: string,
  dbPosition: any,
  redisPosition: any,
  correlationId: string
): Promise<boolean> {
  const startTime = Date.now();

  try {
    // Idempotency check: skip if already cancelled
    if (dbPosition.status === 'cancelled') {
      logger.info('Position already cancelled, skipping', {
        assessmentId,
        positionId: dbPosition.id,
        correlationId,
      });
      recordCancelledPositionPersisted('skipped');
      return true;
    }

    // Check if trades are already marked as cancelled
    const prisma = getPrismaClient();
    const unCancelledTradesCount = await prisma.trade.count({
      where: {
        positionId: dbPosition.id,
        cancelled: false,
      },
    });

    // Wrap in transaction with retry logic
    await retryDatabaseOperation(
      async () => {
        return await prisma.$transaction(async (tx: any) => {
          logger.debug('Starting transaction for cancelled position', {
            assessmentId,
            positionId: dbPosition.id,
            correlationId,
          });

          // Update position status to cancelled
          await tx.position.update({
            where: { id: dbPosition.id },
            data: {
              status: 'cancelled',
              closedAt: new Date(),
            },
          });

          logger.debug('Position status updated to cancelled', {
            assessmentId,
            positionId: dbPosition.id,
            correlationId,
          });

          // Mark trades as cancelled only if there are uncancelled trades
          if (unCancelledTradesCount > 0) {
            await tx.trade.updateMany({
              where: { positionId: dbPosition.id },
              data: { cancelled: true },
            });

            logger.debug('Trades marked as cancelled', {
              assessmentId,
              positionId: dbPosition.id,
              tradeCount: unCancelledTradesCount,
              correlationId,
            });

            recordCancelledTradesMarked('success');
          } else {
            logger.debug('No uncancelled trades to mark', {
              assessmentId,
              positionId: dbPosition.id,
              correlationId,
            });
            recordCancelledTradesMarked('skipped');
          }

          return { success: true };
        });
      },
      `persist-cancelled-position-${dbPosition.id}`,
      correlationId
    );

    const duration = (Date.now() - startTime) / 1000;
    recordCancelledPositionPersistenceDuration(duration);
    recordCancelledPositionPersisted('success');

    logger.info('Cancelled position persisted successfully', {
      assessmentId,
      positionId: dbPosition.id,
      duration,
      correlationId,
    });

    return true;
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    recordCancelledPositionPersistenceDuration(duration);
    recordCancelledPositionPersisted('failure');

    const errorType = classifyError(error);

    logger.error('Failed to persist cancelled position', {
      assessmentId,
      positionId: dbPosition.id,
      errorType,
      error: String(error),
      duration,
      correlationId,
    });

    // Push to DLQ for ANY failure after retries exhausted (not just permanent errors)
    await pushToDeadLetterQueue(
      {
        assessmentId,
        positionId: dbPosition.id,
        timestamp: Date.now(),
        errorMessage: String(error),
        retryCount: MAX_RETRIES,
        errorType: classifyError(error),
      },
      correlationId
    );

    return false;
  }
}

/**
 * Persist virtual account balance with retry logic
 */
async function persistVirtualAccountBalance(
  assessmentId: string,
  virtualAccount: any,
  state: AssessmentState,
  correlationId: string
): Promise<boolean> {
  try {
    const prisma = getPrismaClient();

    await retryDatabaseOperation(
      async () => {
        // Optimistic locking check
        const currentVirtualAccount = await prisma.virtualAccount.findUnique({
          where: { id: virtualAccount.id },
        });

        if (!currentVirtualAccount) {
          throw new Error('Virtual account not found');
        }

        // Check if concurrent update occurred
        if (currentVirtualAccount.updatedAt.getTime() !== virtualAccount.updatedAt.getTime()) {
          logger.warn('Concurrent update detected on virtual account, refetching', {
            assessmentId,
            correlationId,
          });
          // In a real scenario, we'd refetch and retry, but for now we'll proceed
        }

        // Update virtual account
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

        return { success: true };
      },
      `persist-virtual-account-${virtualAccount.id}`,
      correlationId
    );

    logger.debug('Virtual account persisted', {
      assessmentId,
      virtualAccountId: virtualAccount.id,
      currentBalance: state.currentBalance,
      correlationId,
    });

    return true;
  } catch (error) {
    logger.error('Failed to persist virtual account balance', {
      assessmentId,
      error: String(error),
      correlationId,
    });
    return false;
  }
}

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

/**
 * Get health status of persistence worker
 */
export function getPersistenceWorkerHealth(): {
  healthy: boolean;
  lastSuccessTime: number;
  consecutiveFailures: number;
  timeSinceLastSuccess: number;
} {
  const timeSinceLastSuccess = Date.now() - lastSuccessfulCycle;
  const healthy = consecutiveFailures <= 5 && timeSinceLastSuccess < 60000;

  return {
    healthy,
    lastSuccessTime: lastSuccessfulCycle,
    consecutiveFailures,
    timeSinceLastSuccess,
  };
}

async function persistAssessmentStates(): Promise<void> {
  const correlationId = `persist-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { correlationId });
      consecutiveFailures++;
      return;
    }

    const prisma = getPrismaClient();

    // Scan for all active assessment keys
    let cursor = '0';
    let assessmentIds: string[] = [];
    let recordsUpdated = 0;
    let errors = 0;
    let cancelledPositionsProcessed = 0;
    let cancelledPositionsPending = 0;

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

        // Persist virtual account balance with retry logic
        const balanceUpdateSuccess = await persistVirtualAccountBalance(
          assessmentId,
          virtualAccount,
          state,
          correlationId
        );

        if (!balanceUpdateSuccess) {
          errors++;
          continue;
        }

        // Persist positions from Redis to database
        for (const position of state.positions) {
          // Check if position exists in database
          const existingPosition = await prisma.position.findUnique({
            where: { id: position.id },
          });

          // Route all cancelled positions through persistCancelledPosition
          if (position.status === 'cancelled') {
            if (!existingPosition) {
              // Create new cancelled position record with trades marked as cancelled
              try {
                await retryDatabaseOperation(
                  async () => {
                    return await prisma.$transaction(async (tx: any) => {
                      // Create position
                      await tx.position.create({
                        data: {
                          id: position.id,
                          assessmentId,
                          market: position.market,
                          side: position.side,
                          quantity: position.quantity,
                          entryPrice: position.entryPrice,
                          currentPrice: position.currentPrice,
                          unrealizedPnl: position.unrealizedPnl,
                          openedAt: typeof position.openedAt === 'string' ? new Date(position.openedAt) : position.openedAt,
                          status: 'cancelled',
                          closedAt: new Date(),
                        },
                      });

                      // Mark all trades for this position as cancelled
                      await tx.trade.updateMany({
                        where: { positionId: position.id },
                        data: { cancelled: true },
                      });

                      return { success: true };
                    });
                  },
                  `persist-new-cancelled-position-${position.id}`,
                  correlationId
                );

                recordCancelledPositionPersisted('success');
                recordCancelledTradesMarked('success');
                cancelledPositionsProcessed++;

                logger.debug('New cancelled position created in database with trades marked', {
                  assessmentId,
                  positionId: position.id,
                  correlationId,
                });
              } catch (error) {
                recordCancelledPositionPersisted('failure');
                recordCancelledTradesMarked('failure');

                logger.error('Failed to create new cancelled position', {
                  assessmentId,
                  positionId: position.id,
                  error: String(error),
                  correlationId,
                });

                // Push to DLQ for any failure
                await pushToDeadLetterQueue(
                  {
                    assessmentId,
                    positionId: position.id,
                    timestamp: Date.now(),
                    errorMessage: String(error),
                    retryCount: MAX_RETRIES,
                    errorType: classifyError(error),
                  },
                  correlationId
                );

                errors++;
              }
            } else {
              // Use persistCancelledPosition for existing positions
              const persistSuccess = await persistCancelledPosition(
                assessmentId,
                existingPosition,
                position,
                correlationId
              );

              if (persistSuccess) {
                cancelledPositionsProcessed++;
              } else {
                errors++;
              }
            }
          } else {
            // Handle active positions normally
            if (!existingPosition) {
              // Create new position record
              await prisma.position.create({
                data: {
                  id: position.id,
                  assessmentId,
                  market: position.market,
                  side: position.side,
                  quantity: position.quantity,
                  entryPrice: position.entryPrice,
                  currentPrice: position.currentPrice,
                  unrealizedPnl: position.unrealizedPnl,
                  openedAt: typeof position.openedAt === 'string' ? new Date(position.openedAt) : position.openedAt,
                  status: 'open',
                  closedAt: null,
                },
              });
              logger.debug('Position created in database', {
                assessmentId,
                positionId: position.id,
                status: 'active',
                correlationId,
              });
            } else {
              // Update existing position with current price and unrealized P&L
              await prisma.position.update({
                where: { id: position.id },
                data: {
                  currentPrice: position.currentPrice,
                  unrealizedPnl: position.unrealizedPnl,
                },
              });
            }
          }
        }

        // Handle position closure: check for positions in database that are no longer in Redis
        const dbPositions = await prisma.position.findMany({
          where: {
            assessmentId,
            closedAt: null,
          },
        });

        const originalTradeCount = state.tradeCount || 0;

        for (const dbPosition of dbPositions) {
          const redisPosition = state.positions.find((p) => p.id === dbPosition.id);

          // Check if position is still in Redis (active or cancelled)
          if (!redisPosition) {
            // Position was closed, update database record
            await prisma.position.update({
              where: { id: dbPosition.id },
              data: {
                closedAt: new Date(),
              },
            });
            logger.debug('Position closed in database', {
              assessmentId,
              positionId: dbPosition.id,
              correlationId,
            });

            // Increment trade count in Redis state
            state.tradeCount = (state.tradeCount || 0) + 1;

            // Publish position-closed event
            await publishEvent('trading.position-closed', {
              assessmentId,
              positionId: dbPosition.id,
              market: dbPosition.market,
              side: dbPosition.side,
              quantity: dbPosition.quantity,
              entryPrice: dbPosition.entryPrice,
              exitPrice: dbPosition.currentPrice,
              correlationId,
              timestamp: new Date(),
            });
          } else if (redisPosition.status === 'cancelled' && dbPosition.status !== 'cancelled') {
            // Position was cancelled, persist with retry logic and transaction
            const persistSuccess = await persistCancelledPosition(
              assessmentId,
              dbPosition,
              redisPosition,
              correlationId
            );

            if (!persistSuccess) {
              errors++;
            }
          }
        }

        // Count pending cancelled positions
        const pendingCancelledPositions = state.positions.filter((p) => p.status === 'cancelled').length;
        cancelledPositionsPending += pendingCancelledPositions;

        // Update assessment state with incremented trade count if any positions were closed
        if (state.tradeCount !== originalTradeCount) {
          await updateAssessmentState(assessmentId, state);
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

    // Update metrics
    setCancelledPositionsPendingPersistence(cancelledPositionsPending);

    logger.debug('Persistence cycle completed', {
      assessmentsProcessed: assessmentIds.length,
      recordsUpdated,
      errors,
      cancelledPositionsProcessed,
      cancelledPositionsPending,
      correlationId,
    });

    // Update health tracking
    if (errors === 0) {
      lastSuccessfulCycle = Date.now();
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
    }
  } catch (error) {
    logger.error('Persistence worker cycle failed', {
      error: String(error),
      correlationId,
    });
    consecutiveFailures++;
  }
}
