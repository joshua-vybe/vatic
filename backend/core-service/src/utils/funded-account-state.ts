import { getRedisClient } from './redis';
import { createLogger } from './logger';

const logger = createLogger('funded-account-state');

export interface FundedAccountState {
  currentBalance: number;
  peakBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalWithdrawals: number;
  positions: Array<{
    id: string;
    market: string;
    side: string;
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    openedAt: string | Date;
  }>;
}

export interface FundedAccountRules {
  drawdown: {
    value: number;
    threshold: number;
    status: 'safe' | 'warning' | 'danger' | 'violation';
  };
  riskPerTrade: {
    value: number;
    threshold: number;
    status: 'safe' | 'warning' | 'danger' | 'violation';
  };
}

export async function getFundedAccountState(fundedAccountId: string): Promise<FundedAccountState | null> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { fundedAccountId });
      return null;
    }

    const stateJson = await redis.get(`funded:${fundedAccountId}:state`);
    if (!stateJson) {
      logger.debug('Funded account state not found in Redis', { fundedAccountId });
      return null;
    }

    const state = JSON.parse(stateJson) as FundedAccountState;
    logger.debug('Funded account state retrieved from Redis', { fundedAccountId });
    return state;
  } catch (error) {
    logger.error('Failed to get funded account state from Redis', {
      fundedAccountId,
      error: String(error),
    });
    return null;
  }
}

export async function updateFundedAccountState(
  fundedAccountId: string,
  state: FundedAccountState
): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { fundedAccountId });
      return false;
    }

    await redis.set(`funded:${fundedAccountId}:state`, JSON.stringify(state));
    logger.debug('Funded account state updated in Redis', { fundedAccountId });
    return true;
  } catch (error) {
    logger.error('Failed to update funded account state in Redis', {
      fundedAccountId,
      error: String(error),
    });
    return false;
  }
}

export async function deleteFundedAccountState(fundedAccountId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { fundedAccountId });
      return false;
    }

    await redis.del(`funded:${fundedAccountId}:state`, `funded:${fundedAccountId}:rules`);
    logger.debug('Funded account state deleted from Redis', { fundedAccountId });
    return true;
  } catch (error) {
    logger.error('Failed to delete funded account state from Redis', {
      fundedAccountId,
      error: String(error),
    });
    return false;
  }
}

export async function getFundedAccountRules(fundedAccountId: string): Promise<FundedAccountRules | null> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { fundedAccountId });
      return null;
    }

    const rulesJson = await redis.get(`funded:${fundedAccountId}:rules`);
    if (!rulesJson) {
      logger.debug('Funded account rules not found in Redis', { fundedAccountId });
      return null;
    }

    const rules = JSON.parse(rulesJson) as FundedAccountRules;
    logger.debug('Funded account rules retrieved from Redis', { fundedAccountId });
    return rules;
  } catch (error) {
    logger.error('Failed to get funded account rules from Redis', {
      fundedAccountId,
      error: String(error),
    });
    return null;
  }
}

export async function updateFundedAccountRules(
  fundedAccountId: string,
  rules: FundedAccountRules
): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available', { fundedAccountId });
      return false;
    }

    await redis.set(`funded:${fundedAccountId}:rules`, JSON.stringify(rules));
    logger.debug('Funded account rules updated in Redis', { fundedAccountId });
    return true;
  } catch (error) {
    logger.error('Failed to update funded account rules in Redis', {
      fundedAccountId,
      error: String(error),
    });
    return false;
  }
}
