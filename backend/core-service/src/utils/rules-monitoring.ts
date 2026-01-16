import { getPrismaClient } from '../db';
import { getAssessmentState, updateAssessmentRules, updateAssessmentState } from './assessment-state';
import { publishEvent } from './kafka';
import { createLogger } from './logger';

const logger = createLogger('rules-monitoring');

export interface RuleStatus {
  value: number;
  threshold: number;
  status: 'safe' | 'warning' | 'danger' | 'violation';
}

export interface AssessmentRules {
  drawdown: RuleStatus;
  tradeCount: RuleStatus;
  riskPerTrade: RuleStatus;
}

/**
 * Calculate rule status based on value and threshold
 * For drawdown and risk per trade: violation if value >= threshold
 * For trade count: no violation (informational only, tracks progress toward min requirement)
 * - safe: value < threshold * 0.8
 * - warning: value >= threshold * 0.8 && value < threshold * 0.9
 * - danger: value >= threshold * 0.9 && value < threshold
 * - violation: value >= threshold (not applicable for trade count)
 */
export function calculateRuleStatus(value: number, threshold: number, ruleType?: string): string {
  // Trade count is informational only, never violates
  if (ruleType === 'trade_count') {
    if (value < threshold * 0.8) {
      return 'safe';
    } else if (value >= threshold * 0.8 && value < threshold * 0.9) {
      return 'warning';
    } else if (value >= threshold * 0.9 && value < threshold) {
      return 'danger';
    } else {
      // Even if trade count exceeds threshold, it's still 'safe' (no violation)
      return 'safe';
    }
  }

  // For other rules (drawdown, risk per trade)
  if (value < threshold * 0.8) {
    return 'safe';
  } else if (value >= threshold * 0.8 && value < threshold * 0.9) {
    return 'warning';
  } else if (value >= threshold * 0.9 && value < threshold) {
    return 'danger';
  } else {
    return 'violation';
  }
}

/**
 * Calculate current assessment rules
 */
export async function calculateAssessmentRules(assessmentId: string): Promise<AssessmentRules> {
  try {
    const prisma = getPrismaClient();

    // Fetch assessment with tier from database
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { tier: true },
    });

    if (!assessment) {
      logger.error('Assessment not found', { assessmentId });
      throw new Error('Assessment not found');
    }

    // Fetch assessment state from Redis
    const assessmentState = await getAssessmentState(assessmentId);
    if (!assessmentState) {
      logger.error('Assessment state not found in Redis', { assessmentId });
      throw new Error('Assessment state not found');
    }

    // Check if assessment is linked to a funded account
    const fundedAccount = await prisma.fundedAccount?.findFirst({
      where: { assessmentId },
    }).catch(() => null);

    // Determine thresholds based on account type
    let tierLimits;
    if (fundedAccount) {
      // Funded account thresholds
      tierLimits = {
        maxDrawdown: 0.15, // 10-15% drawdown
        minTrades: 0, // No min trades requirement
        maxRiskPerTrade: 0.05, // 5% risk per trade
      };
      logger.debug('Using funded account thresholds', { assessmentId });
    } else {
      // Assessment tier thresholds
      tierLimits = {
        maxDrawdown: assessment.tier?.maxDrawdown || 0.2,
        minTrades: assessment.tier?.minTrades || 0,
        maxRiskPerTrade: assessment.tier?.maxRiskPerTrade || 0.1,
      };
      logger.debug('Using assessment tier thresholds', { assessmentId });
    }

    // Calculate drawdown: (peakBalance - currentBalance) / peakBalance
    const peakBalance = assessmentState.peakBalance || assessmentState.currentBalance;
    const currentBalance = assessmentState.currentBalance;
    const drawdown = peakBalance > 0 ? (peakBalance - currentBalance) / peakBalance : 0;

    // Get trade count from state
    const tradeCount = assessmentState.tradeCount || 0;

    // Calculate current risk per trade from open positions (largest position size / balance)
    let maxRiskPerTrade = 0;
    if (assessmentState.positions && assessmentState.positions.length > 0) {
      for (const position of assessmentState.positions) {
        const positionSize = position.quantity * position.entryPrice;
        const riskPerTrade = positionSize / currentBalance;
        if (riskPerTrade > maxRiskPerTrade) {
          maxRiskPerTrade = riskPerTrade;
        }
      }
    }

    logger.debug('Rules calculated', {
      assessmentId,
      drawdown,
      tradeCount,
      maxRiskPerTrade,
      tierLimits,
      isFundedAccount: !!fundedAccount,
    });

    return {
      drawdown: {
        value: drawdown,
        threshold: tierLimits.maxDrawdown,
        status: calculateRuleStatus(drawdown, tierLimits.maxDrawdown, 'drawdown') as 'safe' | 'warning' | 'danger' | 'violation',
      },
      tradeCount: {
        value: tradeCount,
        threshold: tierLimits.minTrades,
        status: calculateRuleStatus(tradeCount, tierLimits.minTrades, 'trade_count') as 'safe' | 'warning' | 'danger' | 'violation',
      },
      riskPerTrade: {
        value: maxRiskPerTrade,
        threshold: tierLimits.maxRiskPerTrade,
        status: calculateRuleStatus(maxRiskPerTrade, tierLimits.maxRiskPerTrade, 'risk_per_trade') as 'safe' | 'warning' | 'danger' | 'violation',
      },
    };
  } catch (error) {
    logger.error('Failed to calculate assessment rules', {
      assessmentId,
      error: String(error),
    });
    throw error;
  }
}

/**
 * Check if assessment meets minimum trades requirement
 */
export async function checkMinTradesRequirement(assessmentId: string): Promise<boolean> {
  try {
    const prisma = getPrismaClient();

    // Fetch tier min trades requirement
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { tier: true },
    });

    if (!assessment || !assessment.tier) {
      logger.warn('Assessment or tier not found', { assessmentId });
      return true; // Allow if tier not found
    }

    const minTrades = assessment.tier.minTrades || 0;

    // Fetch trade count from Redis state
    const assessmentState = await getAssessmentState(assessmentId);
    if (!assessmentState) {
      logger.warn('Assessment state not found', { assessmentId });
      return false;
    }

    const tradeCount = assessmentState.tradeCount || 0;

    logger.debug('Min trades requirement check', {
      assessmentId,
      tradeCount,
      minTrades,
      met: tradeCount >= minTrades,
    });

    return tradeCount >= minTrades;
  } catch (error) {
    logger.error('Failed to check min trades requirement', {
      assessmentId,
      error: String(error),
    });
    return false;
  }
}

/**
 * Handle rule violation
 */
export async function handleRuleViolation(
  assessmentId: string,
  ruleType: string,
  value: number,
  threshold: number,
  correlationId?: string
): Promise<void> {
  try {
    const prisma = getPrismaClient();

    logger.error('Rule violation detected', {
      assessmentId,
      ruleType,
      value,
      threshold,
      correlationId,
    });

    // Guard: Check if assessment is already failed to prevent repeated violation events
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment) {
      logger.warn('Assessment not found, skipping violation handling', {
        assessmentId,
        correlationId,
      });
      return;
    }

    if (assessment.status === 'failed') {
      logger.debug('Assessment already failed, skipping repeated violation handling', {
        assessmentId,
        ruleType,
        correlationId,
      });
      return;
    }

    // Update assessment status to 'failed' in database
    await prisma.assessment.update({
      where: { id: assessmentId },
      data: { status: 'failed' },
    });

    // Get assessment state and close all open positions
    const assessmentState = await getAssessmentState(assessmentId);
    if (assessmentState && assessmentState.positions && assessmentState.positions.length > 0) {
      // Settle P&L and close positions in database
      for (const position of assessmentState.positions) {
        // Update position with closedAt timestamp
        await prisma.position.update({
          where: { id: position.id },
          data: { closedAt: new Date() },
        }).catch((error: any) => {
          logger.warn('Failed to close position in database', {
            positionId: position.id,
            error: String(error),
            correlationId,
          });
        });

        // Publish position-closed event for each position
        await publishEvent('trading.position-closed', {
          assessmentId,
          positionId: position.id,
          market: position.market,
          side: position.side,
          quantity: position.quantity,
          entryPrice: position.entryPrice,
          exitPrice: position.currentPrice,
          correlationId,
          timestamp: new Date(),
        }).catch((error) => {
          logger.warn('Failed to publish position-closed event', {
            positionId: position.id,
            error: String(error),
            correlationId,
          });
        });
      }

      // Clear positions from Redis state
      assessmentState.positions = [];
      await updateAssessmentState(assessmentId, assessmentState);
    }

    // Create violation record in database
    await prisma.violation.create({
      data: {
        assessmentId,
        ruleType,
        value,
        threshold,
        timestamp: new Date(),
      },
    });

    // Publish Kafka event
    await publishEvent('rules.violation-detected', {
      assessmentId,
      ruleType,
      value,
      threshold,
      correlationId,
      timestamp: new Date(),
    });

    logger.info('Rule violation handled', {
      assessmentId,
      ruleType,
      correlationId,
    });
  } catch (error: any) {
    logger.error('Failed to handle rule violation', {
      assessmentId,
      ruleType,
      error: String(error),
      correlationId,
    });
    throw error;
  }
}

/**
 * Import updateAssessmentState from assessment-state module
 */
export { updateAssessmentState } from './assessment-state';
