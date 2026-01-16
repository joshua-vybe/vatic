import { v4 as uuid } from 'uuid';
import { getPrismaClient } from '../db';
import { getAssessmentState, updateAssessmentState, updatePeakBalance, calculateDrawdown } from '../utils/assessment-state';
import { getMarketPrice, applySlippageAndFees, getMarketType } from '../utils/trading';
import { publishEvent } from '../utils/kafka';
import { createLogger } from '../utils/logger';

const logger = createLogger('order-placement-saga');

export interface OrderPlacementSagaState {
  assessmentId: string;
  market: string;
  side: string;
  quantity: number;
  step: 'validate_risk' | 'execute_order' | 'update_balance' | 'check_drawdown' | 'completed' | 'failed';
  rollbackData: {
    previousBalance?: number;
    previousPositions?: any[];
  };
  correlationId: string;
}

export interface OrderPlacementResult {
  success: boolean;
  orderId?: string;
  position?: any;
  balance?: number;
  status?: string;
  reason?: string;
  error?: string;
  message?: string;
}

/**
 * Execute order placement saga
 */
export async function executeOrderPlacementSaga(
  assessmentId: string,
  market: string,
  side: string,
  quantity: number,
  config: {
    cryptoSlippage: number;
    cryptoFee: number;
    predictionSlippage: number;
    predictionFee: number;
  },
  correlationId?: string
): Promise<OrderPlacementResult> {
  const finalCorrelationId = correlationId || uuid();
  const sagaState: OrderPlacementSagaState = {
    assessmentId,
    market,
    side,
    quantity,
    step: 'validate_risk',
    rollbackData: {},
    correlationId: finalCorrelationId,
  };

  try {
    logger.info('Starting order placement saga', {
      correlationId: finalCorrelationId,
      assessmentId,
      market,
      side,
      quantity,
    });

    // Step 1: Validate side against market type
    const marketTypeValidation = getMarketType(market);
    const validSides = marketTypeValidation === 'crypto' ? ['long', 'short'] : ['yes', 'no'];

    if (!validSides.includes(side)) {
      logger.error('Invalid side for market type', {
        correlationId: finalCorrelationId,
        market,
        marketType: marketTypeValidation,
        side,
        validSides,
      });
      return {
        success: false,
        error: 'Invalid side',
        message: `Side must be one of ${validSides.join(', ')} for ${marketTypeValidation} markets`,
      };
    }

    // Step 2: Fetch Assessment State & Tier Rules
    const prisma = getPrismaClient();
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { tier: true },
    });

    if (!assessment) {
      logger.error('Assessment not found', { correlationId: finalCorrelationId, assessmentId });
      return {
        success: false,
        error: 'Assessment not found',
        message: 'The assessment does not exist',
      };
    }

    if (assessment.status !== 'active') {
      logger.error('Assessment not active', { correlationId: finalCorrelationId, assessmentId, status: assessment.status });
      return {
        success: false,
        error: 'Assessment not active',
        message: `Assessment status is ${assessment.status}`,
      };
    }

    const tierLimits = {
      maxRiskPerTrade: assessment.tier?.maxRiskPerTrade || 0.1,
      maxDrawdown: assessment.tier?.maxDrawdown || 0.2,
    };

    // Step 2: Fetch Current Assessment State from Redis
    const assessmentState = await getAssessmentState(assessmentId);
    if (!assessmentState) {
      logger.error('Failed to fetch assessment state', { correlationId: finalCorrelationId, assessmentId });
      return {
        success: false,
        error: 'Assessment state unavailable',
        message: 'Failed to fetch assessment state from Redis',
      };
    }

    const currentBalance = assessmentState.currentBalance;
    const positions = assessmentState.positions || [];
    const peakBalance = assessmentState.peakBalance || currentBalance;

    // Step 3: Fetch Current Market Price
    const marketPrice = await getMarketPrice(market);
    if (marketPrice === null) {
      logger.error('Market price unavailable', { correlationId: finalCorrelationId, market });
      return {
        success: false,
        error: 'Market data unavailable',
        message: `Unable to fetch price for market ${market}`,
      };
    }

    // Determine execution price based on market type
    let executionPrice: number;
    if (typeof marketPrice === 'object') {
      // Prediction market
      executionPrice = side === 'yes' ? marketPrice.yes : marketPrice.no;
    } else {
      // Crypto market
      executionPrice = marketPrice;
    }

    logger.debug('Market price fetched', {
      correlationId: finalCorrelationId,
      market,
      executionPrice,
    });

    // Step 4: Validate Risk Per Trade
    sagaState.step = 'validate_risk';
    const marketTypeForConfig = getMarketType(market);
    const slippageConfig = {
      slippage: marketTypeForConfig === 'crypto' ? config.cryptoSlippage : config.predictionSlippage,
      fee: marketTypeForConfig === 'crypto' ? config.cryptoFee : config.predictionFee,
    };

    const slippageResult = applySlippageAndFees(executionPrice, quantity, marketTypeForConfig, slippageConfig);
    const positionSize = slippageResult.totalCost;
    const risk = positionSize / currentBalance;

    logger.debug('Risk validation', {
      correlationId: finalCorrelationId,
      positionSize,
      currentBalance,
      risk,
      maxRiskPerTrade: tierLimits.maxRiskPerTrade,
    });

    if (risk > tierLimits.maxRiskPerTrade) {
      logger.error('Risk per trade exceeds limit', {
        correlationId: finalCorrelationId,
        risk,
        maxRiskPerTrade: tierLimits.maxRiskPerTrade,
      });
      return {
        success: false,
        error: 'Risk limit exceeded',
        message: `Risk per trade (${(risk * 100).toFixed(2)}%) exceeds limit (${(tierLimits.maxRiskPerTrade * 100).toFixed(2)}%)`,
      };
    }

    // Step 5: Execute Order (Create Position)
    sagaState.step = 'execute_order';
    const positionId = uuid();
    const newPosition = {
      id: positionId,
      market,
      side,
      quantity,
      entryPrice: slippageResult.executionPrice,
      currentPrice: slippageResult.executionPrice,
      unrealizedPnl: 0,
      openedAt: new Date(),
      status: 'active' as const,
    };

    sagaState.rollbackData.previousPositions = [...positions];

    logger.debug('Position created', {
      correlationId: finalCorrelationId,
      positionId,
      market,
      side,
      quantity,
      entryPrice: slippageResult.executionPrice,
    });

    // Step 6: Update Balance & Positions in Redis
    sagaState.step = 'update_balance';
    const newBalance = currentBalance - slippageResult.totalCost;

    if (newBalance < 0) {
      logger.error('Insufficient balance', {
        correlationId: finalCorrelationId,
        currentBalance,
        totalCost: slippageResult.totalCost,
        newBalance,
      });
      return {
        success: false,
        error: 'Insufficient balance',
        message: `Insufficient balance to execute order. Required: ${slippageResult.totalCost.toFixed(2)}, Available: ${currentBalance.toFixed(2)}`,
      };
    }

    sagaState.rollbackData.previousBalance = currentBalance;

    const updatedState = {
      ...assessmentState,
      currentBalance: newBalance,
      positions: [...positions, newPosition],
    };

    const updateSuccess = await updateAssessmentState(assessmentId, updatedState);
    if (!updateSuccess) {
      logger.error('Failed to update assessment state in Redis', {
        correlationId: finalCorrelationId,
        assessmentId,
      });
      return {
        success: false,
        error: 'State update failed',
        message: 'Failed to persist order state to Redis',
      };
    }

    logger.debug('Assessment state updated', {
      correlationId: finalCorrelationId,
      newBalance,
      positionCount: updatedState.positions.length,
    });

    // Step 7: Update Peak Balance
    if (newBalance > peakBalance) {
      await updatePeakBalance(assessmentId, newBalance);
      logger.debug('Peak balance updated', {
        correlationId: finalCorrelationId,
        peakBalance: newBalance,
      });
    }

    // Step 8: Check Drawdown Violation
    sagaState.step = 'check_drawdown';
    const drawdown = calculateDrawdown(newBalance, peakBalance);

    logger.debug('Drawdown calculated', {
      correlationId: finalCorrelationId,
      drawdown: `${(drawdown * 100).toFixed(2)}%`,
      maxDrawdown: `${(tierLimits.maxDrawdown * 100).toFixed(2)}%`,
    });

    if (drawdown > tierLimits.maxDrawdown) {
      logger.error('Drawdown violation detected', {
        correlationId: finalCorrelationId,
        drawdown: `${(drawdown * 100).toFixed(2)}%`,
        maxDrawdown: `${(tierLimits.maxDrawdown * 100).toFixed(2)}%`,
      });

      // Rollback: Restore previous state
      await rollbackOrderPlacement(assessmentId, sagaState);

      // Update assessment status to failed
      await prisma.assessment.update({
        where: { id: assessmentId },
        data: { status: 'failed' },
      });

      // Publish violation event
      await publishEvent('rules.violation-detected', {
        assessmentId,
        type: 'drawdown_violation',
        drawdown,
        maxDrawdown: tierLimits.maxDrawdown,
        correlationId: finalCorrelationId,
        timestamp: new Date(),
      });

      return {
        success: true,
        status: 'failed',
        reason: 'drawdown_violation',
      };
    }

    // Step 9: Persist Trade to Database (Async)
    // Create Trade record in database
    prisma.trade
      .create({
        data: {
          assessmentId,
          positionId: newPosition.id,
          type: 'open',
          market,
          side,
          quantity,
          price: slippageResult.executionPrice,
          slippage: slippageResult.slippageAmount,
          fee: slippageResult.feeAmount,
          pnl: 0,
        },
      })
      .catch((error) => {
        logger.error('Failed to persist trade to database', {
          correlationId: finalCorrelationId,
          assessmentId,
          positionId: newPosition.id,
          error: String(error),
        });
      });

    // Step 10: Publish Kafka Events
    sagaState.step = 'completed';
    await publishEvent('trading.order-placed', {
      assessmentId,
      market,
      side,
      quantity,
      executionPrice: slippageResult.executionPrice,
      slippage: slippageResult.slippageAmount,
      fee: slippageResult.feeAmount,
      correlationId: finalCorrelationId,
      timestamp: new Date(),
    });

    await publishEvent('trading.order-filled', {
      assessmentId,
      market,
      side,
      quantity,
      executionPrice: slippageResult.executionPrice,
      totalCost: slippageResult.totalCost,
      correlationId: finalCorrelationId,
      timestamp: new Date(),
    });

    await publishEvent('trading.position-opened', {
      assessmentId,
      positionId,
      market,
      side,
      quantity,
      entryPrice: slippageResult.executionPrice,
      correlationId: finalCorrelationId,
      timestamp: new Date(),
    });

    // Step 11: Calculate and Update Rules
    try {
      const { calculateAssessmentRules, updateAssessmentState: updateRulesState } = await import('../utils/rules-monitoring');
      const rules = await calculateAssessmentRules(assessmentId);
      
      // Get current state and update with rules
      const currentState = await getAssessmentState(assessmentId);
      if (currentState) {
        await updateRulesState(assessmentId, currentState);
      }

      // Store rules in Redis
      const redis = await import('../utils/redis').then(m => m.getRedisClient());
      if (redis) {
        await redis.set(`assessment:${assessmentId}:rules`, JSON.stringify(rules));
      }

      logger.debug('Rules updated after order placement', {
        correlationId: finalCorrelationId,
        assessmentId,
        drawdownStatus: rules.drawdown.status,
        riskPerTradeStatus: rules.riskPerTrade.status,
      });
    } catch (error) {
      logger.error('Failed to update rules after order placement', {
        correlationId: finalCorrelationId,
        assessmentId,
        error: String(error),
      });
      // Don't fail the order if rules update fails
    }

    logger.info('Order placement saga completed successfully', {
      correlationId: finalCorrelationId,
      assessmentId,
      positionId,
      newBalance,
    });

    return {
      success: true,
      orderId: uuid(),
      position: newPosition,
      balance: newBalance,
    };
  } catch (error: any) {
    logger.error('Order placement saga failed', {
      correlationId: finalCorrelationId,
      step: sagaState.step,
      error: String(error),
    });

    // Attempt rollback if we've modified state
    if (sagaState.step !== 'validate_risk') {
      try {
        await rollbackOrderPlacement(assessmentId, sagaState);
      } catch (rollbackError) {
        logger.error('Rollback failed', {
          correlationId: finalCorrelationId,
          error: String(rollbackError),
        });
      }
    }

    return {
      success: false,
      error: 'Order placement failed',
      message: String(error),
    };
  }
}

/**
 * Rollback order placement by restoring previous state
 */
async function rollbackOrderPlacement(
  assessmentId: string,
  sagaState: OrderPlacementSagaState
): Promise<void> {
  try {
    logger.info('Rolling back order placement', {
      correlationId: sagaState.correlationId,
      assessmentId,
      step: sagaState.step,
    });

    const assessmentState = await getAssessmentState(assessmentId);
    if (!assessmentState) {
      logger.error('Failed to fetch assessment state for rollback', {
        correlationId: sagaState.correlationId,
        assessmentId,
      });
      return;
    }

    const rollbackState = { ...assessmentState };

    if (sagaState.rollbackData.previousBalance !== undefined) {
      rollbackState.currentBalance = sagaState.rollbackData.previousBalance;
    }

    if (sagaState.rollbackData.previousPositions !== undefined) {
      // Get positions that are being removed during rollback
      const removedPositions = assessmentState.positions.filter(
        (pos) => !sagaState.rollbackData.previousPositions?.some((p) => p.id === pos.id)
      );

      // Publish position-closed events for removed positions
      for (const position of removedPositions) {
        await publishEvent('trading.position-closed', {
          assessmentId,
          positionId: position.id,
          market: position.market,
          side: position.side,
          quantity: position.quantity,
          entryPrice: position.entryPrice,
          exitPrice: position.currentPrice,
          correlationId: sagaState.correlationId,
          timestamp: new Date(),
        });
      }

      rollbackState.positions = sagaState.rollbackData.previousPositions;
    }

    const rollbackSuccess = await updateAssessmentState(assessmentId, rollbackState);
    if (!rollbackSuccess) {
      logger.error('Failed to update assessment state during rollback', {
        correlationId: sagaState.correlationId,
        assessmentId,
      });
      throw new Error('Failed to persist rollback state to Redis');
    }

    logger.info('Order placement rollback completed', {
      correlationId: sagaState.correlationId,
      assessmentId,
      restoredBalance: rollbackState.currentBalance,
      restoredPositionCount: rollbackState.positions?.length || 0,
    });
  } catch (error) {
    logger.error('Rollback failed', {
      correlationId: sagaState.correlationId,
      assessmentId,
      error: String(error),
    });
    throw error;
  }
}
