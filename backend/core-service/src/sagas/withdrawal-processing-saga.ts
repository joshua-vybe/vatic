import { v4 as uuid } from 'uuid';
import { getPrismaClient } from '../db';
import { getFundedAccountState, updateFundedAccountState } from '../utils/funded-account-state';
import { validateWithdrawalRequest, calculateWithdrawableAmount } from '../utils/withdrawal';
import { publishEvent } from '../utils/kafka';
import { createLogger } from '../utils/logger';
import { createPayout } from './stripe-integration';

const logger = createLogger('withdrawal-processing-saga');

export interface WithdrawalProcessingResult {
  success: boolean;
  withdrawalId?: string;
  status?: string;
  requiresReview?: boolean;
  error?: string;
}

/**
 * Execute withdrawal processing saga
 */
export async function executeWithdrawalProcessingSaga(
  fundedAccountId: string,
  userId: string,
  amount: number,
  correlationId?: string
): Promise<WithdrawalProcessingResult> {
  const finalCorrelationId = correlationId || uuid();

  try {
    logger.info('Starting withdrawal processing saga', {
      correlationId: finalCorrelationId,
      fundedAccountId,
      userId,
      amount,
    });

    const prisma = getPrismaClient();

    // Step 1: Validate Request
    const fundedAccount = await prisma.fundedAccount.findUnique({
      where: { id: fundedAccountId },
      include: { fundedVirtualAccount: true, tier: true },
    });

    if (!fundedAccount) {
      logger.error('Funded account not found', { correlationId: finalCorrelationId, fundedAccountId });
      return {
        success: false,
        error: 'Funded account not found',
      };
    }

    if (fundedAccount.userId !== userId) {
      logger.error('Unauthorized withdrawal request', {
        correlationId: finalCorrelationId,
        fundedAccountId,
        userId,
        ownerId: fundedAccount.userId,
      });
      return {
        success: false,
        error: 'Unauthorized',
      };
    }

    if (!fundedAccount.fundedVirtualAccount) {
      logger.error('Funded virtual account not found', { correlationId: finalCorrelationId, fundedAccountId });
      return {
        success: false,
        error: 'Virtual account not found',
      };
    }

    const virtualAccount = fundedAccount.fundedVirtualAccount;
    const withdrawableAmount = calculateWithdrawableAmount(
      virtualAccount.currentBalance,
      virtualAccount.startingBalance,
      virtualAccount.totalWithdrawals,
      fundedAccount.tier.profitSplit
    );

    const validation = await validateWithdrawalRequest(fundedAccountId, amount, withdrawableAmount);
    if (!validation.valid) {
      logger.warn('Withdrawal validation failed', {
        correlationId: finalCorrelationId,
        fundedAccountId,
        amount,
        reason: validation.reason,
      });
      return {
        success: false,
        error: validation.reason,
      };
    }

    logger.debug('Withdrawal validation passed', {
      correlationId: finalCorrelationId,
      fundedAccountId,
      amount,
      withdrawableAmount,
    });

    // Step 2: Create Withdrawal Record
    const withdrawalId = uuid();
    const withdrawal = await prisma.withdrawal.create({
      data: {
        id: withdrawalId,
        fundedAccountId,
        userId,
        amount,
        status: 'pending',
      },
    });

    logger.debug('Withdrawal record created', {
      correlationId: finalCorrelationId,
      withdrawalId,
      amount,
    });

    // Step 3: Auto-Approve or Queue Review
    let requiresReview = false;
    let approvedAt: Date | null = null;

    if (amount < 1000) {
      // Auto-approve
      approvedAt = new Date();
      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'approved', approvedAt },
      });

      logger.debug('Withdrawal auto-approved', {
        correlationId: finalCorrelationId,
        withdrawalId,
        amount,
      });
    } else {
      // Queue for manual review
      requiresReview = true;
      logger.debug('Withdrawal queued for manual review', {
        correlationId: finalCorrelationId,
        withdrawalId,
        amount,
      });
    }

    // Step 4: Process Payout (if auto-approved)
    let stripePayoutId: string | null = null;
    let completedAt: Date | null = null;

    if (approvedAt) {
      try {
        const payout = await createPayout(amount, userId, {
          fundedAccountId,
          withdrawalId,
        });

        stripePayoutId = payout.id;
        completedAt = new Date();

        await prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: {
            status: 'completed',
            completedAt,
            stripePayoutId,
          },
        });

        logger.debug('Stripe payout created', {
          correlationId: finalCorrelationId,
          withdrawalId,
          stripePayoutId,
          amount,
        });
      } catch (error) {
        logger.error('Failed to create Stripe payout', {
          correlationId: finalCorrelationId,
          withdrawalId,
          error: String(error),
        });

        // Rollback
        await rollbackWithdrawal(withdrawalId);
        return {
          success: false,
          error: 'Failed to process payout',
        };
      }
    }

    // Step 5: Update Total Withdrawals
    const newTotalWithdrawals = virtualAccount.totalWithdrawals + amount;
    await prisma.fundedVirtualAccount.update({
      where: { id: virtualAccount.id },
      data: { totalWithdrawals: newTotalWithdrawals },
    });

    // Update Redis state
    const accountState = await getFundedAccountState(fundedAccountId);
    if (accountState) {
      accountState.totalWithdrawals = newTotalWithdrawals;
      await updateFundedAccountState(fundedAccountId, accountState);
    }

    logger.debug('Total withdrawals updated', {
      correlationId: finalCorrelationId,
      fundedAccountId,
      newTotalWithdrawals,
    });

    // Step 6: Publish Events
    await publishEvent('withdrawal.requested', {
      withdrawalId,
      fundedAccountId,
      userId,
      amount,
      status: 'pending',
      requiresReview,
      correlationId: finalCorrelationId,
      timestamp: new Date(),
    });

    if (approvedAt) {
      await publishEvent('withdrawal.approved', {
        withdrawalId,
        fundedAccountId,
        userId,
        amount,
        stripePayoutId,
        correlationId: finalCorrelationId,
        timestamp: new Date(),
      });

      await publishEvent('withdrawal.completed', {
        withdrawalId,
        fundedAccountId,
        userId,
        amount,
        stripePayoutId,
        correlationId: finalCorrelationId,
        timestamp: new Date(),
      });
    }

    logger.info('Withdrawal processing saga completed successfully', {
      correlationId: finalCorrelationId,
      withdrawalId,
      amount,
      status: approvedAt ? 'completed' : 'pending',
      requiresReview,
    });

    return {
      success: true,
      withdrawalId,
      status: approvedAt ? 'completed' : 'pending',
      requiresReview,
    };
  } catch (error: any) {
    logger.error('Withdrawal processing saga failed', {
      correlationId: finalCorrelationId,
      fundedAccountId,
      amount,
      error: String(error),
    });

    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Rollback withdrawal
 */
async function rollbackWithdrawal(withdrawalId: string): Promise<void> {
  try {
    logger.info('Rolling back withdrawal', { withdrawalId });

    const prisma = getPrismaClient();

    await prisma.withdrawal.delete({
      where: { id: withdrawalId },
    }).catch(() => {
      // Already deleted or doesn't exist
    });

    logger.info('Withdrawal rollback completed', { withdrawalId });
  } catch (error) {
    logger.error('Rollback failed', {
      withdrawalId,
      error: String(error),
    });
  }
}
