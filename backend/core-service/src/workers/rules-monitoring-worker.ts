import { getRedisClient } from '../utils/redis';
import { calculateAssessmentRules, handleRuleViolation, updateAssessmentState } from '../utils/rules-monitoring';
import { getAssessmentState } from '../utils/assessment-state';
import { createLogger } from '../utils/logger';

const logger = createLogger('rules-monitoring-worker');

let monitoringInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export async function startRulesMonitoringWorker(): Promise<void> {
  if (isRunning) {
    logger.warn('Rules monitoring worker already running');
    return;
  }

  isRunning = true;
  logger.info('Starting rules monitoring worker');

  monitoringInterval = setInterval(async () => {
    await monitorAssessmentRules();
  }, 1500); // 1.5 second interval
}

export async function stopRulesMonitoringWorker(): Promise<void> {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    isRunning = false;
    logger.info('Rules monitoring worker stopped');
  }
}

async function monitorAssessmentRules(): Promise<void> {
  const correlationId = `monitor-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();

  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { correlationId });
      return;
    }

    // Scan for all active assessment keys
    let cursor = '0';
    let assessmentIds: string[] = [];

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

    let violationsDetected = 0;
    let errorsEncountered = 0;
    let skippedFailedAssessments = 0;

    // Monitor each assessment
    for (const assessmentId of assessmentIds) {
      try {
        // Guard: Skip assessments that are already failed
        const prisma = await import('../db').then(m => m.getPrismaClient());
        const assessment = await prisma.assessment.findUnique({
          where: { id: assessmentId },
        });

        if (!assessment) {
          logger.debug('Assessment not found, skipping', { assessmentId, correlationId });
          continue;
        }

        if (assessment.status === 'failed') {
          logger.debug('Assessment already failed, skipping monitoring', {
            assessmentId,
            correlationId,
          });
          skippedFailedAssessments++;
          continue;
        }

        // Calculate current rules
        const rules = await calculateAssessmentRules(assessmentId);

        // Update Redis rules
        const currentState = await getAssessmentState(assessmentId);
        if (currentState) {
          await updateAssessmentState(assessmentId, currentState);
        }

        // Store rules in Redis
        await redis.set(`assessment:${assessmentId}:rules`, JSON.stringify(rules));

        // Check for violations
        if (rules.drawdown.status === 'violation') {
          await handleRuleViolation(assessmentId, 'drawdown', rules.drawdown.value, rules.drawdown.threshold, correlationId);
          violationsDetected++;
        } else if (rules.riskPerTrade.status === 'violation') {
          await handleRuleViolation(assessmentId, 'risk_per_trade', rules.riskPerTrade.value, rules.riskPerTrade.threshold, correlationId);
          violationsDetected++;
        }

        logger.debug('Assessment rules monitored', {
          assessmentId,
          drawdownStatus: rules.drawdown.status,
          tradeCountStatus: rules.tradeCount.status,
          riskPerTradeStatus: rules.riskPerTrade.status,
          correlationId,
        });
      } catch (error) {
        logger.error('Failed to monitor assessment rules', {
          assessmentId,
          error: String(error),
          correlationId,
        });
        errorsEncountered++;
      }
    }

    const latency = Date.now() - startTime;
    logger.debug('Rules monitoring cycle completed', {
      assessmentsProcessed: assessmentIds.length,
      skippedFailedAssessments,
      violationsDetected,
      errors: errorsEncountered,
      latency,
      correlationId,
    });
  } catch (error) {
    logger.error('Rules monitoring worker cycle failed', {
      error: String(error),
      correlationId,
    });
  }
}
