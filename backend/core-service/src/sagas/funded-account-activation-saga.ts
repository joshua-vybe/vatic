import { v4 as uuid } from 'uuid';
import { getPrismaClient } from '../db';
import { updateFundedAccountState, updateFundedAccountRules, FundedAccountState, FundedAccountRules } from '../utils/funded-account-state';
import { publishEvent } from '../utils/kafka';
import { createLogger } from '../utils/logger';

const logger = createLogger('funded-account-activation-saga');

export interface FundedAccountActivationResult {
  success: boolean;
  fundedAccountId?: string;
  error?: string;
}

/**
 * Execute funded account activation saga
 */
export async function executeFundedAccountActivationSaga(
  assessmentId: string,
  correlationId?: string
): Promise<FundedAccountActivationResult> {
  const finalCorrelationId = correlationId || uuid();

  try {
    logger.info('Starting funded account activation saga', {
      correlationId: finalCorrelationId,
      assessmentId,
    });

    const prisma = getPrismaClient();

    // Step 1: Verify Assessment Passed
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { tier: true },
    });

    if (!assessment) {
      logger.error('Assessment not found', { correlationId: finalCorrelationId, assessmentId });
      return {
        success: false,
        error: 'Assessment not found',
      };
    }

    if (assessment.status !== 'passed') {
      logger.error('Assessment not passed', {
        correlationId: finalCorrelationId,
        assessmentId,
        status: assessment.status,
      });
      return {
        success: false,
        error: `Assessment status is ${assessment.status}`,
      };
    }

    if (!assessment.completedAt) {
      logger.error('Assessment not completed', { correlationId: finalCorrelationId, assessmentId });
      return {
        success: false,
        error: 'Assessment not completed',
      };
    }

    // Step 2: Check Existing Funded Account (idempotency)
    const existingFundedAccount = await prisma.fundedAccount.findUnique({
      where: { assessmentId },
    });

    if (existingFundedAccount) {
      logger.info('Funded account already exists for assessment', {
        correlationId: finalCorrelationId,
        assessmentId,
        fundedAccountId: existingFundedAccount.id,
      });
      return {
        success: true,
        fundedAccountId: existingFundedAccount.id,
      };
    }

    // Step 3: Create Funded Account
    const fundedAccountId = uuid();
    const fundedAccount = await prisma.fundedAccount.create({
      data: {
        id: fundedAccountId,
        userId: assessment.userId,
        assessmentId,
        tierId: assessment.tierId,
        status: 'active',
      },
    });

    logger.debug('Funded account created', {
      correlationId: finalCorrelationId,
      fundedAccountId,
      userId: assessment.userId,
    });

    // Step 4: Initialize Virtual Account
    const startingBalance = assessment.tier.startingBalance;
    const fundedVirtualAccount = await prisma.fundedVirtualAccount.create({
      data: {
        id: uuid(),
        fundedAccountId,
        startingBalance,
        currentBalance: startingBalance,
        peakBalance: startingBalance,
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalWithdrawals: 0,
      },
    });

    logger.debug('Funded virtual account created', {
      correlationId: finalCorrelationId,
      fundedAccountId,
      startingBalance,
    });

    // Step 5: Initialize Redis State
    const initialState: FundedAccountState = {
      currentBalance: startingBalance,
      peakBalance: startingBalance,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalWithdrawals: 0,
      positions: [],
    };

    const stateUpdateSuccess = await updateFundedAccountState(fundedAccountId, initialState);
    if (!stateUpdateSuccess) {
      logger.error('Failed to initialize funded account state in Redis', {
        correlationId: finalCorrelationId,
        fundedAccountId,
      });
      // Rollback
      await rollbackFundedAccountActivation(fundedAccountId, fundedVirtualAccount.id);
      return {
        success: false,
        error: 'Failed to initialize state',
      };
    }

    logger.debug('Funded account state initialized in Redis', {
      correlationId: finalCorrelationId,
      fundedAccountId,
    });

    // Step 6: Initialize Redis Rules
    const initialRules: FundedAccountRules = {
      drawdown: {
        value: 0,
        threshold: assessment.tier.maxDrawdown, // 10-15% for funded accounts
        status: 'safe',
      },
      riskPerTrade: {
        value: 0,
        threshold: assessment.tier.maxRiskPerTrade, // 5% for funded accounts
        status: 'safe',
      },
    };

    const rulesUpdateSuccess = await updateFundedAccountRules(fundedAccountId, initialRules);
    if (!rulesUpdateSuccess) {
      logger.error('Failed to initialize funded account rules in Redis', {
        correlationId: finalCorrelationId,
        fundedAccountId,
      });
      // Rollback
      await rollbackFundedAccountActivation(fundedAccountId, fundedVirtualAccount.id);
      return {
        success: false,
        error: 'Failed to initialize rules',
      };
    }

    logger.debug('Funded account rules initialized in Redis', {
      correlationId: finalCorrelationId,
      fundedAccountId,
    });

    // Step 7: Publish Events
    await publishEvent('funded-account.created', {
      fundedAccountId,
      userId: assessment.userId,
      assessmentId,
      tierId: assessment.tierId,
      startingBalance,
      correlationId: finalCorrelationId,
      timestamp: new Date(),
    });

    await publishEvent('funded-account.activated', {
      fundedAccountId,
      userId: assessment.userId,
      assessmentId,
      status: 'active',
      correlationId: finalCorrelationId,
      timestamp: new Date(),
    });

    logger.info('Funded account activation saga completed successfully', {
      correlationId: finalCorrelationId,
      fundedAccountId,
      userId: assessment.userId,
    });

    return {
      success: true,
      fundedAccountId,
    };
  } catch (error: any) {
    logger.error('Funded account activation saga failed', {
      correlationId: finalCorrelationId,
      assessmentId,
      error: String(error),
    });

    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Rollback funded account activation
 */
async function rollbackFundedAccountActivation(fundedAccountId: string, virtualAccountId: string): Promise<void> {
  try {
    logger.info('Rolling back funded account activation', { fundedAccountId });

    const prisma = getPrismaClient();

    // Delete virtual account (cascade will handle it)
    await prisma.fundedVirtualAccount.delete({
      where: { id: virtualAccountId },
    }).catch(() => {
      // Already deleted or doesn't exist
    });

    // Delete funded account
    await prisma.fundedAccount.delete({
      where: { id: fundedAccountId },
    }).catch(() => {
      // Already deleted or doesn't exist
    });

    logger.info('Funded account activation rollback completed', { fundedAccountId });
  } catch (error) {
    logger.error('Rollback failed', {
      fundedAccountId,
      error: String(error),
    });
  }
}
