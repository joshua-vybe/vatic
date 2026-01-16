import { getPrismaClient } from '../db';
import { getFundedAccountState } from './funded-account-state';
import { createLogger } from './logger';

const logger = createLogger('withdrawal');

export interface WithdrawalValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Calculate withdrawable amount for a funded account
 * Formula: profitSplit × (currentBalance - startingBalance - totalWithdrawals)
 */
export function calculateWithdrawableAmount(
  currentBalance: number,
  startingBalance: number,
  totalWithdrawals: number,
  profitSplit: number
): number {
  const profit = currentBalance - startingBalance - totalWithdrawals;
  if (profit <= 0) {
    return 0;
  }
  return profitSplit * profit;
}

/**
 * Validate withdrawal request
 */
export async function validateWithdrawalRequest(
  fundedAccountId: string,
  amount: number,
  withdrawableAmount: number
): Promise<WithdrawalValidation> {
  try {
    const prisma = getPrismaClient();

    // Check funded account status is "active"
    const fundedAccount = await prisma.fundedAccount.findUnique({
      where: { id: fundedAccountId },
    });

    if (!fundedAccount) {
      return {
        valid: false,
        reason: 'Funded account not found',
      };
    }

    if (fundedAccount.status !== 'active') {
      return {
        valid: false,
        reason: `Funded account status is ${fundedAccount.status}`,
      };
    }

    // Verify no open positions exist
    const accountState = await getFundedAccountState(fundedAccountId);
    if (accountState && accountState.positions && accountState.positions.length > 0) {
      return {
        valid: false,
        reason: 'Cannot withdraw while positions are open',
      };
    }

    // Verify amount >= $100 minimum
    if (amount < 100) {
      return {
        valid: false,
        reason: 'Minimum withdrawal amount is $100',
      };
    }

    // Verify amount <= withdrawable amount
    if (amount > withdrawableAmount) {
      return {
        valid: false,
        reason: `Withdrawal amount exceeds available balance of $${withdrawableAmount.toFixed(2)}`,
      };
    }

    return { valid: true };
  } catch (error) {
    logger.error('Failed to validate withdrawal request', {
      fundedAccountId,
      amount,
      error: String(error),
    });
    return {
      valid: false,
      reason: 'Validation error',
    };
  }
}
