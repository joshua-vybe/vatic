import { Elysia } from 'elysia';
import { v4 as uuid } from 'uuid';
import { getPrismaClient } from '../db';
import { publishEvent } from '../utils/kafka';
import { createAuthMiddleware } from '../middleware/auth';
import { createLogger } from '../utils/logger';
import { createPayout } from '../sagas/stripe-integration';
import { getFundedAccountState, updateFundedAccountState } from '../utils/funded-account-state';

const logger = createLogger('admin-routes');

export interface AdminConfig {
  jwtSecret: string;
}

export function createAdminRoutes(config: AdminConfig) {
  const authMiddleware = createAuthMiddleware(config.jwtSecret);
  const prisma = getPrismaClient();

  return new Elysia()
    .use(authMiddleware)
    // GET /admin/withdrawals/pending - List all pending withdrawals
    .get(
      '/admin/withdrawals/pending',
      async ({
        userId,
      }: {
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();

        try {
          logger.info('Fetching pending withdrawals', { correlationId, userId });

          // TODO: Verify user is admin (check user role or separate admin JWT)
          // For now, just log the request

          const pendingWithdrawals = await prisma.withdrawal.findMany({
            where: { status: 'pending' },
            include: {
              user: true,
              fundedAccount: {
                include: {
                  tier: true,
                  fundedVirtualAccount: true,
                },
              },
            },
            orderBy: { requestedAt: 'desc' },
          });

          logger.debug('Pending withdrawals fetched', {
            correlationId,
            count: pendingWithdrawals.length,
          });

          return new Response(
            JSON.stringify({
              withdrawals: pendingWithdrawals,
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to fetch pending withdrawals', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to fetch pending withdrawals',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // POST /admin/withdrawals/:id/approve - Approve withdrawal
    .post(
      '/admin/withdrawals/:id/approve',
      async ({
        params,
        userId,
      }: {
        params: { id: string };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const withdrawalId = params.id;

        try {
          logger.info('Approving withdrawal', { correlationId, withdrawalId, userId });

          // TODO: Verify user is admin

          const withdrawal = await prisma.withdrawal.findUnique({
            where: { id: withdrawalId },
            include: { fundedAccount: true },
          });

          if (!withdrawal) {
            return new Response(
              JSON.stringify({
                error: 'Withdrawal not found',
                correlationId,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (withdrawal.status !== 'pending') {
            return new Response(
              JSON.stringify({
                error: 'Withdrawal is not pending',
                message: `Current status: ${withdrawal.status}`,
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Update status to approved
          const approvedAt = new Date();
          await prisma.withdrawal.update({
            where: { id: withdrawalId },
            data: { status: 'approved', approvedAt },
          });

          logger.debug('Withdrawal approved', {
            correlationId,
            withdrawalId,
            amount: withdrawal.amount,
          });

          // Process payout
          let stripePayoutId: string | null = null;
          let completedAt: Date | null = null;

          try {
            const payout = await createPayout(withdrawal.amount, withdrawal.userId, {
              fundedAccountId: withdrawal.fundedAccountId,
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
              correlationId,
              withdrawalId,
              stripePayoutId,
            });
          } catch (error) {
            logger.error('Failed to create Stripe payout', {
              correlationId,
              withdrawalId,
              error: String(error),
            });

            return new Response(
              JSON.stringify({
                error: 'Payout failed',
                message: 'Failed to process payout',
                correlationId,
              }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Publish events
          await publishEvent('withdrawal.approved', {
            withdrawalId,
            fundedAccountId: withdrawal.fundedAccountId,
            userId: withdrawal.userId,
            amount: withdrawal.amount,
            stripePayoutId,
            correlationId,
            timestamp: new Date(),
          });

          await publishEvent('withdrawal.completed', {
            withdrawalId,
            fundedAccountId: withdrawal.fundedAccountId,
            userId: withdrawal.userId,
            amount: withdrawal.amount,
            stripePayoutId,
            correlationId,
            timestamp: new Date(),
          });

          logger.info('Withdrawal approved and processed', {
            correlationId,
            withdrawalId,
            stripePayoutId,
          });

          return new Response(
            JSON.stringify({
              withdrawal: {
                id: withdrawalId,
                status: 'completed',
                stripePayoutId,
                completedAt,
              },
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to approve withdrawal', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to approve withdrawal',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // POST /admin/withdrawals/:id/reject - Reject withdrawal
    .post(
      '/admin/withdrawals/:id/reject',
      async ({
        params,
        body,
        userId,
      }: {
        params: { id: string };
        body: { reason: string };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const withdrawalId = params.id;
        const { reason } = body;

        try {
          logger.info('Rejecting withdrawal', { correlationId, withdrawalId, userId, reason });

          // TODO: Verify user is admin

          const withdrawal = await prisma.withdrawal.findUnique({
            where: { id: withdrawalId },
            include: { fundedAccount: { include: { fundedVirtualAccount: true } } },
          });

          if (!withdrawal) {
            return new Response(
              JSON.stringify({
                error: 'Withdrawal not found',
                correlationId,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (withdrawal.status !== 'pending') {
            return new Response(
              JSON.stringify({
                error: 'Withdrawal is not pending',
                message: `Current status: ${withdrawal.status}`,
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Update status to rejected
          const rejectedAt = new Date();
          await prisma.withdrawal.update({
            where: { id: withdrawalId },
            data: { status: 'rejected', rejectedAt, rejectionReason: reason },
          });

          logger.debug('Withdrawal rejected', {
            correlationId,
            withdrawalId,
            reason,
          });

          // Publish event
          await publishEvent('withdrawal.rejected', {
            withdrawalId,
            fundedAccountId: withdrawal.fundedAccountId,
            userId: withdrawal.userId,
            amount: withdrawal.amount,
            reason,
            correlationId,
            timestamp: new Date(),
          });

          logger.info('Withdrawal rejected', {
            correlationId,
            withdrawalId,
            reason,
          });

          return new Response(
            JSON.stringify({
              withdrawal: {
                id: withdrawalId,
                status: 'rejected',
                rejectionReason: reason,
                rejectedAt,
              },
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to reject withdrawal', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to reject withdrawal',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    );
}
