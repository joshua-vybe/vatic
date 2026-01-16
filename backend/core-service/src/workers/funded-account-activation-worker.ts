import { getRedisClient } from '../utils/redis';
import { executeFundedAccountActivationSaga } from '../sagas/funded-account-activation-saga';
import { createLogger } from '../utils/logger';

const logger = createLogger('funded-account-activation-worker');

let isRunning = false;

export async function startFundedAccountActivationWorker(): Promise<void> {
  if (isRunning) {
    logger.warn('Funded account activation worker already running');
    return;
  }

  isRunning = true;
  logger.info('Starting funded account activation worker');

  // This worker is triggered by Kafka consumer in the main index.ts
  // It listens to assessment.completed events and processes them
}

export async function stopFundedAccountActivationWorker(): Promise<void> {
  isRunning = false;
  logger.info('Funded account activation worker stopped');
}

/**
 * Process assessment completed event for funded account activation
 */
export async function processAssessmentCompletedEvent(
  assessmentId: string,
  status: string,
  correlationId?: string
): Promise<void> {
  try {
    // Only process passed assessments
    if (status !== 'passed') {
      logger.debug('Assessment not passed, skipping funded account activation', {
        assessmentId,
        status,
      });
      return;
    }

    logger.info('Processing assessment completed event for funded account activation', {
      assessmentId,
      status,
      correlationId,
    });

    const result = await executeFundedAccountActivationSaga(assessmentId, correlationId);

    if (result.success) {
      logger.info('Funded account activated successfully', {
        assessmentId,
        fundedAccountId: result.fundedAccountId,
        correlationId,
      });
    } else {
      logger.error('Failed to activate funded account', {
        assessmentId,
        error: result.error,
        correlationId,
      });
    }
  } catch (error) {
    logger.error('Error processing assessment completed event', {
      assessmentId,
      error: String(error),
      correlationId,
    });
  }
}
