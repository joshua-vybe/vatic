import { Elysia, t } from 'elysia';
import { v4 as uuid } from 'uuid';
import { getPrismaClient } from '../db';
import { getFundedAccountState, getFundedAccountRules } from '../utils/funded-account-state';
import { calculateWithdrawableAmount } from '../utils/withdrawal';
import { executeWithdrawalProcessingSaga } from '../sagas/withdrawal-processing-saga';
import { createAuthMiddleware } from '../middleware/auth';
import { createLogger } from '../utils/logger';

const logger = createLogger('funded-routes');

export interface FundedConfig {
  jwtSecret: string;
}

export function createFundedRoutes(config: FundedConfig) {
  const authMiddleware = createAuthMiddleware(config.jwtSecret);
  const prisma = getPrismaClient();

  return new Elysia()
    .use(authMiddleware)
    // GET /funded-accounts - List all funded accounts for authenticated user
    .get(
      '/funded-accounts',
      async ({
        userId,
      }: {
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();

        try {
          logger.info('Fetching funded accounts', { correlationId, userId });

          const fundedAccounts = await prisma.fundedAccount.findMany({
            where: { userId },
            include: {
              tier: true,
              fundedVirtualAccount: true,
              assessment: true,
              withdrawals: true,
            },
            orderBy: { activatedAt: 'desc' },
          });

          // Calculate withdrawal summary for each account
          const accountsWithSummary = fundedAccounts.map((account) => {
            const withdrawals = account.withdrawals || [];
            const pending = withdrawals.filter((w) => w.status === 'pending').reduce((sum, w) => sum + w.amount, 0);
            const completed = withdrawals.filter((w) => w.status === 'completed').reduce((sum, w) => sum + w.amount, 0);
            const total = account.fundedVirtualAccount?.totalWithdrawals || 0;

            return {
              ...account,
              withdrawalSummary: {
                total,
                pending,
                completed,
              },
            };
          });

          logger.debug('Funded accounts fetched', {
            correlationId,
            userId,
            count: fundedAccounts.length,
          });

          return new Response(
            JSON.stringify({
              fundedAccounts: accountsWithSummary,
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to fetch funded accounts', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to fetch funded accounts',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // GET /funded-accounts/:id - Retrieve single funded account details
    .get(
      '/funded-accounts/:id',
      async ({
        params,
        userId,
      }: {
        params: { id: string };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const fundedAccountId = params.id;

        try {
          logger.info('Fetching funded account', { correlationId, fundedAccountId, userId });

          const fundedAccount = await prisma.fundedAccount.findUnique({
            where: { id: fundedAccountId },
            include: {
              tier: true,
              fundedVirtualAccount: true,
              assessment: true,
            },
          });

          if (!fundedAccount) {
            return new Response(
              JSON.stringify({
                error: 'Funded account not found',
                correlationId,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (fundedAccount.userId !== userId) {
            logger.warn('Unauthorized access to funded account', {
              correlationId,
              fundedAccountId,
              userId,
              ownerId: fundedAccount.userId,
            });
            return new Response(
              JSON.stringify({
                error: 'Forbidden',
                message: 'Access denied',
                correlationId,
              }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Merge Redis state with database
          const redisState = await getFundedAccountState(fundedAccountId);
          const redisRules = await getFundedAccountRules(fundedAccountId);

          const virtualAccount = fundedAccount.fundedVirtualAccount;
          const withdrawableAmount = virtualAccount
            ? calculateWithdrawableAmount(
                redisState?.currentBalance || virtualAccount.currentBalance,
                virtualAccount.startingBalance,
                virtualAccount.totalWithdrawals,
                fundedAccount.tier.profitSplit
              )
            : 0;

          logger.debug('Funded account fetched', {
            correlationId,
            fundedAccountId,
            status: fundedAccount.status,
          });

          return new Response(
            JSON.stringify({
              fundedAccount: {
                ...fundedAccount,
                realTimeState: redisState,
                rulesStatus: redisRules,
                withdrawableAmount,
              },
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to fetch funded account', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to fetch funded account',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // POST /funded-accounts/:id/withdraw - Request withdrawal
    .post(
      '/funded-accounts/:id/withdraw',
      async ({
        params,
        body,
        userId,
      }: {
        params: { id: string };
        body: { amount: number };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const fundedAccountId = params.id;
        const { amount } = body;

        try {
          logger.info('Withdrawal request received', {
            correlationId,
            fundedAccountId,
            userId,
            amount,
          });

          // Verify user owns funded account
          const fundedAccount = await prisma.fundedAccount.findUnique({
            where: { id: fundedAccountId },
          });

          if (!fundedAccount) {
            return new Response(
              JSON.stringify({
                error: 'Funded account not found',
                correlationId,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (fundedAccount.userId !== userId) {
            logger.warn('Unauthorized withdrawal request', {
              correlationId,
              fundedAccountId,
              userId,
              ownerId: fundedAccount.userId,
            });
            return new Response(
              JSON.stringify({
                error: 'Forbidden',
                message: 'Access denied',
                correlationId,
              }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Execute withdrawal saga
          const result = await executeWithdrawalProcessingSaga(fundedAccountId, userId, amount, correlationId);

          if (!result.success) {
            logger.warn('Withdrawal processing failed', {
              correlationId,
              error: result.error,
            });
            return new Response(
              JSON.stringify({
                error: 'Withdrawal failed',
                message: result.error,
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          logger.info('Withdrawal processed successfully', {
            correlationId,
            withdrawalId: result.withdrawalId,
            status: result.status,
            requiresReview: result.requiresReview,
          });

          return new Response(
            JSON.stringify({
              withdrawalId: result.withdrawalId,
              status: result.status,
              requiresReview: result.requiresReview,
              estimatedCompletion: result.requiresReview ? '24-48 hours' : '1-2 days',
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Withdrawal request error', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to process withdrawal',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // GET /funded-accounts/:id/withdrawals - List withdrawals for funded account
    .get(
      '/funded-accounts/:id/withdrawals',
      async ({
        params,
        userId,
      }: {
        params: { id: string };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const fundedAccountId = params.id;

        try {
          logger.info('Fetching withdrawals', { correlationId, fundedAccountId, userId });

          // Verify user owns funded account
          const fundedAccount = await prisma.fundedAccount.findUnique({
            where: { id: fundedAccountId },
          });

          if (!fundedAccount) {
            return new Response(
              JSON.stringify({
                error: 'Funded account not found',
                correlationId,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (fundedAccount.userId !== userId) {
            logger.warn('Unauthorized access to withdrawals', {
              correlationId,
              fundedAccountId,
              userId,
              ownerId: fundedAccount.userId,
            });
            return new Response(
              JSON.stringify({
                error: 'Forbidden',
                message: 'Access denied',
                correlationId,
              }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }

          const withdrawals = await prisma.withdrawal.findMany({
            where: { fundedAccountId },
            orderBy: { requestedAt: 'desc' },
          });

          logger.debug('Withdrawals fetched', {
            correlationId,
            fundedAccountId,
            count: withdrawals.length,
          });

          return new Response(
            JSON.stringify({
              withdrawals,
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to fetch withdrawals', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to fetch withdrawals',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    );
}
