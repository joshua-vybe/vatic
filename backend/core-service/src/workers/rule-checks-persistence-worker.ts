import { getPrismaClient } from '../db';
import { getRedisClient } from '../utils/redis';
import { createLogger } from '../utils/logger';

const logger = createLogger('rule-checks-persistence-worker');

let persistenceInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export async function startRuleChecksPersistenceWorker(): Promise<void> {
  if (isRunning) {
    logger.warn('Rule checks persistence worker already running');
    return;
  }

  isRunning = true;
  logger.info('Starting rule checks persistence worker');

  persistenceInterval = setInterval(async () => {
    await persistRuleChecks();
  }, 12000); // 12 second interval
}

export async function stopRuleChecksPersistenceWorker(): Promise<void> {
  if (persistenceInterval) {
    clearInterval(persistenceInterval);
    persistenceInterval = null;
    isRunning = false;
    logger.info('Rule checks persistence worker stopped');
  }
}

async function persistRuleChecks(): Promise<void> {
  const correlationId = `persist-rules-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();

  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { correlationId });
      return;
    }

    const prisma = getPrismaClient();

    // Scan for all assessment rules keys
    let cursor = '0';
    let ruleCheckRecords: Array<{
      assessmentId: string;
      ruleType: string;
      value: number;
      threshold: number;
      status: string;
    }> = [];

    do {
      const result = await redis.scan(cursor, 'MATCH', 'assessment:*:rules', 'COUNT', '100');
      cursor = result[0];
      const keys = result[1];

      for (const key of keys) {
        try {
          // Extract assessment ID from key format: assessment:{id}:rules
          const match = key.match(/^assessment:(.+):rules$/);
          if (!match) continue;

          const assessmentId = match[1];
          const rulesJson = await redis.get(key);
          if (!rulesJson) continue;

          const rules = JSON.parse(rulesJson);

          // Create records for each rule type
          if (rules.drawdown) {
            ruleCheckRecords.push({
              assessmentId,
              ruleType: 'drawdown',
              value: rules.drawdown.value,
              threshold: rules.drawdown.threshold,
              status: rules.drawdown.status,
            });
          }

          if (rules.tradeCount) {
            ruleCheckRecords.push({
              assessmentId,
              ruleType: 'trade_count',
              value: rules.tradeCount.value,
              threshold: rules.tradeCount.threshold,
              status: rules.tradeCount.status,
            });
          }

          if (rules.riskPerTrade) {
            ruleCheckRecords.push({
              assessmentId,
              ruleType: 'risk_per_trade',
              value: rules.riskPerTrade.value,
              threshold: rules.riskPerTrade.threshold,
              status: rules.riskPerTrade.status,
            });
          }
        } catch (error) {
          logger.error('Failed to parse rules from Redis', {
            key,
            error: String(error),
            correlationId,
          });
        }
      }
    } while (cursor !== '0');

    // Batch insert rule check records
    if (ruleCheckRecords.length > 0) {
      try {
        await prisma.ruleCheck.createMany({
          data: ruleCheckRecords.map((record) => ({
            assessmentId: record.assessmentId,
            ruleType: record.ruleType,
            value: record.value,
            threshold: record.threshold,
            status: record.status,
            timestamp: new Date(),
          })),
          skipDuplicates: true,
        });

        logger.debug('Rule checks persisted', {
          recordsInserted: ruleCheckRecords.length,
          correlationId,
        });
      } catch (error) {
        logger.error('Failed to batch insert rule checks', {
          recordCount: ruleCheckRecords.length,
          error: String(error),
          correlationId,
        });
      }
    }

    const latency = Date.now() - startTime;
    logger.debug('Rule checks persistence cycle completed', {
      recordsProcessed: ruleCheckRecords.length,
      latency,
      correlationId,
    });
  } catch (error) {
    logger.error('Rule checks persistence worker cycle failed', {
      error: String(error),
      correlationId,
    });
  }
}
