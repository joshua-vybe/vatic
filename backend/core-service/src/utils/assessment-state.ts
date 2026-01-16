import { getRedisClient } from './redis';
import { createLogger } from './logger';

const logger = createLogger('assessment-state');

export interface AssessmentState {
  currentBalance: number;
  peakBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  positions: Array<{
    id: string;
    market: string;
    side: string;
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    openedAt: string | Date;
    status: 'active' | 'cancelled';
  }>;
}

export interface AssessmentRules {
  drawdown: {
    value: number;
    threshold: number;
    status: 'safe' | 'warning' | 'violated';
  };
  tradeCount: {
    value: number;
    threshold: number;
    status: 'safe' | 'warning' | 'violated';
  };
  riskPerTrade: {
    value: number;
    threshold: number;
    status: 'safe' | 'warning' | 'violated';
  };
}

export async function getAssessmentState(assessmentId: string): Promise<AssessmentState | null> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { assessmentId });
      return null;
    }

    const stateJson = await redis.get(`assessment:${assessmentId}:state`);
    if (!stateJson) {
      logger.debug('Assessment state not found in Redis', { assessmentId });
      return null;
    }

    const state = JSON.parse(stateJson) as AssessmentState;
    logger.debug('Assessment state retrieved from Redis', { assessmentId });
    return state;
  } catch (error) {
    logger.error('Failed to get assessment state from Redis', {
      assessmentId,
      error: String(error),
    });
    return null;
  }
}

export async function updateAssessmentState(
  assessmentId: string,
  state: AssessmentState
): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { assessmentId });
      return false;
    }

    await redis.set(`assessment:${assessmentId}:state`, JSON.stringify(state));
    logger.debug('Assessment state updated in Redis', { assessmentId });
    return true;
  } catch (error) {
    logger.error('Failed to update assessment state in Redis', {
      assessmentId,
      error: String(error),
    });
    return false;
  }
}

export async function deleteAssessmentState(assessmentId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { assessmentId });
      return false;
    }

    await redis.del(`assessment:${assessmentId}:state`, `assessment:${assessmentId}:rules`);
    logger.debug('Assessment state deleted from Redis', { assessmentId });
    return true;
  } catch (error) {
    logger.error('Failed to delete assessment state from Redis', {
      assessmentId,
      error: String(error),
    });
    return false;
  }
}

export function calculateDrawdown(currentBalance: number, peakBalance: number): number {
  if (peakBalance === 0 || currentBalance >= peakBalance) {
    return 0;
  }
  return (peakBalance - currentBalance) / peakBalance;
}

export async function updatePeakBalance(
  assessmentId: string,
  currentBalance: number
): Promise<boolean> {
  try {
    const state = await getAssessmentState(assessmentId);
    if (!state) {
      logger.warn('Assessment state not found', { assessmentId });
      return false;
    }

    if (currentBalance > state.peakBalance) {
      state.peakBalance = currentBalance;
      return await updateAssessmentState(assessmentId, state);
    }

    return true;
  } catch (error) {
    logger.error('Failed to update peak balance', {
      assessmentId,
      error: String(error),
    });
    return false;
  }
}

export async function getAssessmentRules(assessmentId: string): Promise<AssessmentRules | null> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { assessmentId });
      return null;
    }

    const rulesJson = await redis.get(`assessment:${assessmentId}:rules`);
    if (!rulesJson) {
      logger.debug('Assessment rules not found in Redis', { assessmentId });
      return null;
    }

    const rules = JSON.parse(rulesJson) as AssessmentRules;
    logger.debug('Assessment rules retrieved from Redis', { assessmentId });
    return rules;
  } catch (error) {
    logger.error('Failed to get assessment rules from Redis', {
      assessmentId,
      error: String(error),
    });
    return null;
  }
}

export async function updateAssessmentRules(
  assessmentId: string,
  rules: AssessmentRules
): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { assessmentId });
      return false;
    }

    await redis.set(`assessment:${assessmentId}:rules`, JSON.stringify(rules));
    logger.debug('Assessment rules updated in Redis', { assessmentId });
    return true;
  } catch (error) {
    logger.error('Failed to update assessment rules in Redis', {
      assessmentId,
      error: String(error),
    });
    return false;
  }
}
