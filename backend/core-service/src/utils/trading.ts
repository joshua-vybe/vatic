import { getRedisClient } from './redis';
import { createLogger } from './logger';

const logger = createLogger('trading-utils');

/**
 * Fetch current market price from Redis
 * Crypto prices stored as string numbers, prediction market prices as JSON
 */
export async function getMarketPrice(
  market: string
): Promise<number | { yes: number; no: number } | null> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available for market price fetch', { market });
      return null;
    }

    const key = `market:${market}:price`;
    const value = await redis.get(key);

    if (!value) {
      logger.debug('Market price not found', { market, key });
      return null;
    }

    // Try to parse as JSON (prediction market format)
    if (value.startsWith('{')) {
      try {
        const parsed = JSON.parse(value);
        if (parsed.yes !== undefined && parsed.no !== undefined) {
          return { yes: parsed.yes, no: parsed.no };
        }
      } catch {
        // Fall through to parse as number
      }
    }

    // Parse as number (crypto format)
    const numPrice = parseFloat(value);
    if (isNaN(numPrice)) {
      logger.error('Invalid market price format', { market, value });
      return null;
    }

    return numPrice;
  } catch (error) {
    logger.error('Failed to fetch market price', { market, error: String(error) });
    return null;
  }
}

/**
 * Calculate P&L for crypto positions
 * Long: (currentPrice - entryPrice) × quantity
 * Short: (entryPrice - currentPrice) × quantity
 */
export function calculateCryptoPnL(
  side: string,
  quantity: number,
  entryPrice: number,
  currentPrice: number
): number {
  if (side === 'long') {
    return (currentPrice - entryPrice) * quantity;
  } else if (side === 'short') {
    return (entryPrice - currentPrice) * quantity;
  }
  return 0;
}

/**
 * Calculate P&L for prediction market positions
 * Yes side: outcome === 'yes' ? quantity × (1 - entryPrice) : -quantity × entryPrice
 * No side: outcome === 'no' ? quantity × (1 - entryPrice) : -quantity × entryPrice
 * Note: Only realized on event settlement, unrealized tracks current market price
 */
export function calculatePredictionMarketPnL(
  side: string,
  quantity: number,
  entryPrice: number,
  outcome: 'yes' | 'no'
): number {
  if (side === 'yes') {
    return outcome === 'yes' ? quantity * (1 - entryPrice) : -quantity * entryPrice;
  } else if (side === 'no') {
    return outcome === 'no' ? quantity * (1 - entryPrice) : -quantity * entryPrice;
  }
  return 0;
}

/**
 * Calculate unrealized P&L for prediction markets using current market price
 * Clamps currentPrice to [0,1] range before computing P&L
 */
export function calculatePredictionMarketUnrealizedPnL(
  side: string,
  quantity: number,
  entryPrice: number,
  currentPrice: number
): number {
  // Clamp currentPrice to [0,1] range for binary prediction markets
  const cappedPrice = Math.min(1, Math.max(0, currentPrice));
  
  if (side === 'yes') {
    return quantity * (cappedPrice - entryPrice);
  } else if (side === 'no') {
    return quantity * ((1 - cappedPrice) - (1 - entryPrice));
  }
  return 0;
}

export interface SlippageAndFeeResult {
  executionPrice: number;
  slippageAmount: number;
  feeAmount: number;
  totalCost: number;
}

/**
 * Apply slippage and fees to market price
 * Crypto: executionPrice = price × (1 + slippage)
 * Prediction: Similar but capped at 1.0
 */
export function applySlippageAndFees(
  price: number,
  quantity: number,
  marketType: 'crypto' | 'prediction',
  config: { slippage: number; fee: number }
): SlippageAndFeeResult {
  let executionPrice = price * (1 + config.slippage);

  // Cap prediction market prices at 1.0
  if (marketType === 'prediction' && executionPrice > 1.0) {
    executionPrice = 1.0;
  }

  const slippageAmount = (executionPrice - price) * quantity;
  const feeAmount = executionPrice * quantity * config.fee;
  const totalCost = executionPrice * quantity + feeAmount;

  return {
    executionPrice,
    slippageAmount,
    feeAmount,
    totalCost,
  };
}

/**
 * Detect market type from market identifier
 */
export function getMarketType(market: string): 'crypto' | 'prediction' {
  if (market.startsWith('polymarket:') || market.startsWith('kalshi:')) {
    return 'prediction';
  }
  return 'crypto';
}

/**
 * Calculate cancellation refund for a position
 * Formula: (entryPrice × quantity) + fees
 * Cost recovery only, no profit/loss included
 */
export function calculateCancellationRefund(
  entryPrice: number,
  quantity: number,
  feePercent: number
): number {
  const positionCost = entryPrice * quantity;
  const feeAmount = positionCost * feePercent;
  return positionCost + feeAmount;
}
