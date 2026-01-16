import { getPrismaClient } from '../db';
import { getFundedAccountState } from '../utils/funded-account-state';
import { createLogger } from '../utils/logger';

const logger = createLogger('funded-account-persistence-worker');

let persistenceInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export async function startFundedAccountPersistenceWorker(): Promise<void> {
  if (isRunning) {
    logger.warn('Funded account persistence worker already running');
    return;
  }

  isRunning = true;
  logger.info('Starting funded account persistence worker');

  persistenceInterval = setInterval(async () => {
    await persistFundedAccountState();
  }, 5000); // Run every 5 seconds
}

export async function stopFundedAccountPersistenceWorker(): Promise<void> {
  if (persistenceInterval) {
    clearInterval(persistenceInterval);
    persistenceInterval = null;
  }
  isRunning = false;
  logger.info('Funded account persistence worker stopped');
}

async function persistFundedAccountState(): Promise<void> {
  const correlationId = `persist-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  try {
    const prisma = getPrismaClient();

    // Query all active funded accounts
    const fundedAccounts = await prisma.fundedAccount.findMany({
      where: { status: 'active' },
      include: { fundedVirtualAccount: true },
    });

    logger.debug('Persisting funded account state', {
      correlationId,
      count: fundedAccounts.length,
    });

    let persistedCount = 0;
    let errorCount = 0;

    for (const fundedAccount of fundedAccounts) {
      try {
        // Fetch Redis state
        const redisState = await getFundedAccountState(fundedAccount.id);

        if (!redisState || !fundedAccount.fundedVirtualAccount) {
          continue;
        }

        // Update FundedVirtualAccount with current balances and P&L
        await prisma.fundedVirtualAccount.update({
          where: { id: fundedAccount.fundedVirtualAccount.id },
          data: {
            currentBalance: redisState.currentBalance,
            peakBalance: redisState.peakBalance,
            realizedPnl: redisState.realizedPnl,
            unrealizedPnl: redisState.unrealizedPnl,
            totalWithdrawals: redisState.totalWithdrawals,
          },
        });

        persistedCount++;

        logger.debug('Funded account state persisted', {
          fundedAccountId: fundedAccount.id,
          currentBalance: redisState.currentBalance,
          peakBalance: redisState.peakBalance,
        });
      } catch (error) {
        logger.warn('Failed to persist funded account state', {
          fundedAccountId: fundedAccount.id,
          error: String(error),
        });
        errorCount++;
      }
    }

    logger.debug('Funded account persistence cycle completed', {
      correlationId,
      persistedCount,
      errorCount,
      totalAccounts: fundedAccounts.length,
    });
  } catch (error) {
    logger.error('Funded account persistence worker cycle failed', {
      correlationId,
      error: String(error),
    });
  }
}
