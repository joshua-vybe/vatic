import axios from 'axios';
import { Logger } from '../utils/logger';

export interface AssessmentDetails {
  id: string;
  userId: string;
  tierId: string;
  status: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  virtualAccount: {
    startingBalance: number;
    currentBalance: number;
    peakBalance: number;
    realizedPnl: number;
    unrealizedPnl: number;
  };
  tier: {
    name: string;
    maxDrawdown: number;
    minTrades: number;
  };
}

export interface Trade {
  id: string;
  type: string;
  market: string;
  side: string;
  quantity: number;
  price: number;
  slippage: number;
  fee: number;
  pnl: number;
  timestamp: string;
}

export interface Position {
  id: string;
  market: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  openedAt: string;
  closedAt: string | null;
}

export interface RuleCheck {
  id: string;
  ruleType: string;
  value: number;
  threshold: number;
  status: string;
  timestamp: string;
}

export interface TierAverages {
  avgPnl: number;
  avgTradeCount: number;
  totalAssessments: number;
}

export async function fetchAssessmentDetails(
  assessmentId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<AssessmentDetails> {
  try {
    const response = await axios.get<AssessmentDetails>(
      `${coreServiceUrl}/assessments/${assessmentId}`
    );
    logger.debug('Fetched assessment details', { assessmentId });
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch assessment details', {
      assessmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchTrades(
  assessmentId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<Trade[]> {
  try {
    const response = await axios.get<Trade[]>(
      `${coreServiceUrl}/trades?assessmentId=${assessmentId}`
    );
    logger.debug('Fetched trades', { assessmentId, count: response.data.length });
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch trades', {
      assessmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchPositions(
  assessmentId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<Position[]> {
  try {
    const response = await axios.get<Position[]>(
      `${coreServiceUrl}/positions?assessmentId=${assessmentId}`
    );
    logger.debug('Fetched positions', { assessmentId, count: response.data.length });
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch positions', {
      assessmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchRuleChecks(
  assessmentId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<RuleCheck[]> {
  try {
    const response = await axios.get<RuleCheck[]>(
      `${coreServiceUrl}/rules?assessmentId=${assessmentId}`
    );
    logger.debug('Fetched rule checks', { assessmentId, count: response.data.length });
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch rule checks', {
      assessmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchTierAverages(
  tierId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<TierAverages> {
  try {
    const response = await axios.get<TierAverages>(
      `${coreServiceUrl}/tiers/${tierId}/averages`
    );
    logger.debug('Fetched tier averages', { tierId });
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch tier averages', {
      tierId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
