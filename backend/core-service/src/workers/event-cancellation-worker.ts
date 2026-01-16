import { v4 as uuid } from 'uuid';
import { getRedisClient } from '../utils/redis';
import { getAssessmentState, updateAssessmentState } from '../utils/assessment-state';
import { publishEvent } from '../utils/kafka';
import { createLogger } from '../utils/logger';
import { getMarketType, calculateCancellationRefund } from '../utils/trading';
import { loadConfig } from '../config';
import { runWithCorrelationId } from '../utils/correlation-id';
import { context, propagation } from '@opentelemetry/api';

const logger = createLogger('event-cancellation-worker');

let isRunning = false;

export async function startEventCancellationWorker(): Promise<void> {
  if (isRunning) {
    logger.warn('Event cancellation worker already running');
    return;
  }

  isRunning = true;
  logger.info('Starting event cancellation worker');

  // This worker is triggered by Kafka consumer in the main index.ts
  // It listens to events.event-cancelled events and processes them
}

export async function stopEventCancellationWorker(): Promise<void> {
  isRunning = false;
  logger.info('Event cancellation worker stopped');
}

/**
 * Process event cancellation event
 */
export async function processEventCancellationEvent(
  eventId: string,
  source: string,
  status: string,
  correlationId?: string,
  carrier?: Record<string, string>
): Promise<void> {
  const finalCorrelationId = correlationId || uuid();

  try {
    await runWithCorrelationId(finalCorrelationId, async () => {
      // Extract trace context if provided
      const extractedContext = carrier ? propagation.extract(context.active(), carrier) : context.active();

      await context.with(extractedContext, async () => {
        logger.info('Processing event cancellation event', {
          eventId,
          source,
          status,
          correlationId: finalCorrelationId,
        });

        // Load trading configuration
        const config = loadConfig();

        // Step 1: Find affected positions
        const redis = getRedisClient();
        if (!redis) {
          logger.error('Redis client not available', { correlationId: finalCorrelationId });
          return;
        }

        logger.debug('Scanning for affected assessments', {
          eventId,
          correlationId: finalCorrelationId,
        });

        // Scan all assessment states
        const assessmentKeys: string[] = [];
        let cursor = '0';
        do {
          const [newCursor, keys] = await redis.scan(cursor, 'MATCH', 'assessment:*:state', 'COUNT', 100);
          cursor = newCursor;
          assessmentKeys.push(...keys);
        } while (cursor !== '0');

        logger.debug('Found assessment keys', {
          count: assessmentKeys.length,
          correlationId: finalCorrelationId,
        });

        // Step 2: Process each assessment
        let totalRefundAmount = 0;
        let affectedAssessments = 0;
        let affectedPositions = 0;

        for (const key of assessmentKeys) {
          try {
            // Extract assessment ID from key (format: assessment:ID:state)
            const assessmentId = key.split(':')[1];

            const assessmentState = await getAssessmentState(assessmentId);
            if (!assessmentState) {
              logger.debug('Assessment state not found', { assessmentId, correlationId: finalCorrelationId });
              continue;
            }

            // Step 3: Filter positions by event ID
            const affectedPositionsInAssessment = assessmentState.positions.filter(
              (pos) => pos.market === eventId || pos.market === `polymarket:${eventId}` || pos.market === `kalshi:${eventId}`
            );

            if (affectedPositionsInAssessment.length === 0) {
              logger.debug('No affected positions in assessment', {
                assessmentId,
                eventId,
                correlationId: finalCorrelationId,
              });
              continue;
            }

            logger.info('Found affected positions in assessment', {
              assessmentId,
              eventId,
              affectedCount: affectedPositionsInAssessment.length,
              correlationId: finalCorrelationId,
            });

            affectedAssessments++;
            affectedPositions += affectedPositionsInAssessment.length;

            // Step 4: Calculate refunds for each position
            let assessmentRefundAmount = 0;
            const refundDetails: Array<{
              positionId: string;
              refundAmount: number;
              entryPrice: number;
              quantity: number;
            }> = [];

            for (const position of affectedPositionsInAssessment) {
              try {
                const marketType = getMarketType(position.market);
                const slippageConfig = {
                  slippage: marketType === 'crypto' ? config.cryptoSlippage : config.predictionSlippage,
                  fee: marketType === 'crypto' ? config.cryptoFee : config.predictionFee,
                };

                // Calculate refund using shared helper: (entryPrice × quantity) + fee
                const refundAmount = calculateCancellationRefund(
                  position.entryPrice,
                  position.quantity,
                  slippageConfig.fee
                );

                assessmentRefundAmount += refundAmount;

                refundDetails.push({
                  positionId: position.id,
                  refundAmount,
                  entryPrice: position.entryPrice,
                  quantity: position.quantity,
                });

                logger.debug('Calculated refund for position', {
                  assessmentId,
                  positionId: position.id,
                  market: position.market,
                  refundAmount,
                  correlationId: finalCorrelationId,
                });
              } catch (error) {
                logger.error('Failed to calculate refund for position', {
                  assessmentId,
                  positionId: position.id,
                  error: String(error),
                  correlationId: finalCorrelationId,
                });
                // Continue processing other positions
              }
            }

            // Step 5: Update Redis state
            try {
              // Mark cancelled positions with status = 'cancelled'
              const updatedPositions = assessmentState.positions.map((pos) => {
                if (affectedPositionsInAssessment.some((ap) => ap.id === pos.id)) {
                  return {
                    ...pos,
                    status: 'cancelled' as const,
                  };
                }
                return pos;
              });

              // Recalculate unrealizedPnL from remaining active positions
              const activePositions = updatedPositions.filter((pos) => pos.status === 'active');
              const recalculatedUnrealizedPnL = activePositions.reduce(
                (sum, pos) => sum + pos.unrealizedPnl,
                0
              );

              const updatedState = {
                ...assessmentState,
                currentBalance: assessmentState.currentBalance + assessmentRefundAmount,
                positions: updatedPositions,
                unrealizedPnl: recalculatedUnrealizedPnL,
              };

              const updateSuccess = await updateAssessmentState(assessmentId, updatedState);
              if (!updateSuccess) {
                logger.error('Failed to update assessment state', {
                  assessmentId,
                  correlationId: finalCorrelationId,
                });
                continue;
              }

              logger.info('Assessment state updated with refunds', {
                assessmentId,
                refundAmount: assessmentRefundAmount,
                newBalance: updatedState.currentBalance,
                recalculatedUnrealizedPnL,
                correlationId: finalCorrelationId,
              });

              totalRefundAmount += assessmentRefundAmount;

              // Step 6: Publish refund events for each position
              for (const refund of refundDetails) {
                try {
                  const position = affectedPositionsInAssessment.find((p) => p.id === refund.positionId);
                  if (!position) continue;

                  await publishEvent('trading.position-refunded', {
                    assessmentId,
                    positionId: refund.positionId,
                    market: position.market,
                    side: position.side,
                    quantity: position.quantity,
                    entryPrice: position.entryPrice,
                    refundAmount: refund.refundAmount,
                    reason: 'event_cancelled',
                    eventId,
                    eventSource: source,
                    correlationId: finalCorrelationId,
                    timestamp: new Date(),
                  });

                  logger.debug('Refund event published', {
                    assessmentId,
                    positionId: refund.positionId,
                    refundAmount: refund.refundAmount,
                    correlationId: finalCorrelationId,
                  });
                } catch (error) {
                  logger.error('Failed to publish refund event', {
                    assessmentId,
                    positionId: refund.positionId,
                    error: String(error),
                    correlationId: finalCorrelationId,
                  });
                  // Continue publishing other events
                }
              }
            } catch (error) {
              logger.error('Failed to process assessment for refunds', {
                assessmentId,
                error: String(error),
                correlationId: finalCorrelationId,
              });
              // Continue processing other assessments
            }
          } catch (error) {
            logger.error('Error processing assessment', {
              key,
              error: String(error),
              correlationId: finalCorrelationId,
            });
            // Continue processing other assessments
          }
        }

        logger.info('Event cancellation processing completed', {
          eventId,
          source,
          affectedAssessments,
          affectedPositions,
          totalRefundAmount,
          correlationId: finalCorrelationId,
        });
      });
    });
  } catch (error) {
    logger.error('Error processing event cancellation event', {
      eventId,
      source,
      error: String(error),
      correlationId: finalCorrelationId,
    });
  }
}
