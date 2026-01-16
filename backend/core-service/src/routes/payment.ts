import { Elysia, t } from 'elysia';
import Stripe from 'stripe';
import { getPrismaClient } from '../db';
import { getStripeClient } from '../utils/stripe';
import { publishEvent } from '../utils/kafka';
import { createLogger } from '../utils/logger';
import { createAuthMiddleware } from '../middleware/auth';

const logger = createLogger('payment-routes');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export function createPaymentRoutes(stripeSecretKey: string, stripeWebhookSecret: string) {
  const authMiddleware = createAuthMiddleware(process.env.JWT_SECRET || '');
  const prisma = getPrismaClient();
  const stripe = getStripeClient();

  return new Elysia()
    // GET /tiers - Public endpoint to list all tiers
    .get('/tiers', async (): Promise<Response> => {
      try {
        const tiers = await prisma.tier.findMany({
          orderBy: { price: 'asc' },
        });

        logger.info('Tiers retrieved', { count: tiers.length });

        return new Response(
          JSON.stringify({
            tiers: tiers.map((tier) => ({
              id: tier.id,
              name: tier.name,
              price: tier.price,
              startingBalance: tier.startingBalance,
              maxDrawdown: tier.maxDrawdown,
              minTrades: tier.minTrades,
              maxRiskPerTrade: tier.maxRiskPerTrade,
              profitSplit: tier.profitSplit,
            })),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        logger.error('Failed to retrieve tiers', { error: String(error) });
        return new Response(
          JSON.stringify({ error: 'Internal Server Error', message: 'Failed to retrieve tiers' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    })
    // POST /webhooks/stripe - Stripe webhook handler (BEFORE auth middleware)
    .post('/webhooks/stripe', async ({ request }: { request: Request }): Promise<Response> => {
      const correlationId = `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      try {
        // Get raw body for signature verification
        const rawBody = await request.text();

        // Verify webhook signature
        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(
            rawBody,
            request.headers.get('stripe-signature') || '',
            stripeWebhookSecret
          );
          logger.info('Webhook signature verified', {
            eventType: event.type,
            eventId: event.id,
            correlationId,
          });
        } catch (signatureError) {
          logger.warn('Invalid webhook signature', {
            error: String(signatureError),
            correlationId,
          });
          return new Response(
            JSON.stringify({ error: 'Invalid signature' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Handle payment_intent.succeeded event
        if (event.type === 'payment_intent.succeeded') {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;

          logger.info('Processing payment_intent.succeeded', {
            paymentIntentId: paymentIntent.id,
            correlationId,
          });

          try {
            // Fetch purchase by stripePaymentId - source of truth
            const purchase = await prisma.purchase.findUnique({
              where: { stripePaymentId: paymentIntent.id },
              include: { assessments: true },
            });

            if (!purchase) {
              logger.warn('Purchase not found for payment intent', {
                paymentIntentId: paymentIntent.id,
                correlationId,
              });
              return new Response(
                JSON.stringify({ received: true }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }

            // Check if purchase is already completed or has assessment (idempotency)
            if (purchase.status === 'completed' && purchase.assessments.length > 0) {
              logger.info('Purchase already completed with assessment, skipping duplicate processing', {
                purchaseId: purchase.id,
                correlationId,
              });
              return new Response(
                JSON.stringify({ received: true }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }

            // Start database transaction
            const result = await retryWithBackoff(async () => {
              return await prisma.$transaction(async (tx: any) => {
                // Update purchase status to completed
                const updatedPurchase = await tx.purchase.update({
                  where: { id: purchase.id },
                  data: {
                    status: 'completed',
                    completedAt: new Date(),
                  },
                });

                logger.info('Purchase status updated to completed', {
                  purchaseId: updatedPurchase.id,
                  correlationId,
                });

                // Create assessment record (will fail if duplicate due to unique constraint)
                const assessment = await tx.assessment.create({
                  data: {
                    userId: purchase.userId,
                    tierId: purchase.tierId,
                    purchaseId: purchase.id,
                    status: 'pending',
                  },
                });

                logger.info('Assessment created', {
                  assessmentId: assessment.id,
                  purchaseId: purchase.id,
                  correlationId,
                });

                return { purchase: updatedPurchase, assessment };
              });
            });

            // Publish Kafka events (non-blocking)
            publishEvent('assessment.created', {
              assessmentId: result.assessment.id,
              userId: purchase.userId,
              tierId: purchase.tierId,
              purchaseId: purchase.id,
              status: 'pending',
              correlationId,
              timestamp: Date.now(),
            }).catch((error) => {
              logger.error('Failed to publish assessment.created event', {
                error: String(error),
                correlationId,
              });
            });

            publishEvent('payment.purchase-completed', {
              userId: purchase.userId,
              tierId: purchase.tierId,
              purchaseId: purchase.id,
              assessmentId: result.assessment.id,
              correlationId,
              timestamp: Date.now(),
            }).catch((error) => {
              logger.error('Failed to publish purchase-completed event', {
                error: String(error),
                correlationId,
              });
            });

            logger.info('Payment succeeded event processed', {
              purchaseId: purchase.id,
              assessmentId: result.assessment.id,
              correlationId,
            });
          } catch (transactionError) {
            logger.error('Transaction failed for payment_intent.succeeded', {
              error: String(transactionError),
              paymentIntentId: paymentIntent.id,
              correlationId,
            });

            // Attempt to fetch purchase and update status to failed
            try {
              const failedPurchase = await prisma.purchase.findUnique({
                where: { stripePaymentId: paymentIntent.id },
              });

              if (failedPurchase) {
                await prisma.purchase.update({
                  where: { id: failedPurchase.id },
                  data: { status: 'failed' },
                });

                publishEvent('payment.purchase-failed', {
                  userId: failedPurchase.userId,
                  tierId: failedPurchase.tierId,
                  purchaseId: failedPurchase.id,
                  reason: 'Assessment creation failed',
                  correlationId,
                  timestamp: Date.now(),
                }).catch((error) => {
                  logger.error('Failed to publish purchase-failed event', {
                    error: String(error),
                    correlationId,
                  });
                });
              }
            } catch (updateError) {
              logger.error('Failed to update purchase status to failed', {
                error: String(updateError),
                correlationId,
              });
            }

            return new Response(
              JSON.stringify({ error: 'Transaction failed' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        // Handle payment_intent.payment_failed event
        if (event.type === 'payment_intent.payment_failed') {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;

          logger.info('Processing payment_intent.payment_failed', {
            paymentIntentId: paymentIntent.id,
            reason: paymentIntent.last_payment_error?.message,
            correlationId,
          });

          try {
            // Fetch purchase by stripePaymentId - source of truth
            const purchase = await prisma.purchase.findUnique({
              where: { stripePaymentId: paymentIntent.id },
            });

            if (!purchase) {
              logger.warn('Purchase not found for failed payment intent', {
                paymentIntentId: paymentIntent.id,
                correlationId,
              });
              return new Response(
                JSON.stringify({ received: true }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }

            // Update purchase status to failed
            const updatedPurchase = await prisma.purchase.update({
              where: { id: purchase.id },
              data: { status: 'failed' },
            });

            logger.info('Purchase status updated to failed', {
              purchaseId: updatedPurchase.id,
              correlationId,
            });

            // Publish Kafka event (non-blocking)
            publishEvent('payment.purchase-failed', {
              userId: purchase.userId,
              tierId: purchase.tierId,
              purchaseId: purchase.id,
              reason: paymentIntent.last_payment_error?.message || 'Payment failed',
              correlationId,
              timestamp: Date.now(),
            }).catch((error) => {
              logger.error('Failed to publish purchase-failed event', {
                error: String(error),
                correlationId,
              });
            });
          } catch (error) {
            logger.error('Failed to process payment_intent.payment_failed', {
              error: String(error),
              paymentIntentId: paymentIntent.id,
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Failed to process payment failure' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        // Handle payout.paid event
        if (event.type === 'payout.paid') {
          const payout = event.data.object as Stripe.Payout;

          logger.info('Processing payout.paid', {
            payoutId: payout.id,
            amount: payout.amount,
            correlationId,
          });

          try {
            // Find withdrawal by stripePayoutId
            const withdrawal = await prisma.withdrawal.findFirst({
              where: { stripePayoutId: payout.id },
              include: { fundedAccount: true },
            });

            if (!withdrawal) {
              logger.warn('Withdrawal not found for payout', {
                payoutId: payout.id,
                correlationId,
              });
              return new Response(
                JSON.stringify({ received: true }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }

            // Update withdrawal status to completed
            const completedAt = new Date();
            await prisma.withdrawal.update({
              where: { id: withdrawal.id },
              data: {
                status: 'completed',
                completedAt,
              },
            });

            logger.info('Withdrawal marked as completed', {
              withdrawalId: withdrawal.id,
              payoutId: payout.id,
              correlationId,
            });

            // Publish Kafka event (non-blocking)
            publishEvent('withdrawal.completed', {
              withdrawalId: withdrawal.id,
              fundedAccountId: withdrawal.fundedAccountId,
              userId: withdrawal.userId,
              amount: withdrawal.amount,
              stripePayoutId: payout.id,
              correlationId,
              timestamp: Date.now(),
            }).catch((error) => {
              logger.error('Failed to publish withdrawal.completed event', {
                error: String(error),
                correlationId,
              });
            });
          } catch (error) {
            logger.error('Failed to process payout.paid', {
              error: String(error),
              payoutId: payout.id,
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Failed to process payout' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        // Handle payout.failed event
        if (event.type === 'payout.failed') {
          const payout = event.data.object as Stripe.Payout;

          logger.info('Processing payout.failed', {
            payoutId: payout.id,
            failureCode: payout.failure_code,
            failureMessage: payout.failure_message,
            correlationId,
          });

          try {
            // Find withdrawal by stripePayoutId
            const withdrawal = await prisma.withdrawal.findFirst({
              where: { stripePayoutId: payout.id },
              include: { fundedAccount: { include: { fundedVirtualAccount: true } } },
            });

            if (!withdrawal) {
              logger.warn('Withdrawal not found for failed payout', {
                payoutId: payout.id,
                correlationId,
              });
              return new Response(
                JSON.stringify({ received: true }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }

            // Update withdrawal status to rejected
            const rejectedAt = new Date();
            await prisma.withdrawal.update({
              where: { id: withdrawal.id },
              data: {
                status: 'rejected',
                rejectedAt,
                rejectionReason: payout.failure_message || 'Payout failed',
              },
            });

            logger.info('Withdrawal marked as rejected due to payout failure', {
              withdrawalId: withdrawal.id,
              payoutId: payout.id,
              failureMessage: payout.failure_message,
              correlationId,
            });

            // Revert totalWithdrawals in FundedVirtualAccount
            if (withdrawal.fundedAccount.fundedVirtualAccount) {
              const virtualAccount = withdrawal.fundedAccount.fundedVirtualAccount;
              await prisma.fundedVirtualAccount.update({
                where: { id: virtualAccount.id },
                data: {
                  totalWithdrawals: Math.max(0, virtualAccount.totalWithdrawals - withdrawal.amount),
                },
              });

              logger.debug('Reverted totalWithdrawals', {
                fundedAccountId: withdrawal.fundedAccountId,
                amount: withdrawal.amount,
                correlationId,
              });
            }

            // Publish Kafka event (non-blocking)
            publishEvent('withdrawal.failed', {
              withdrawalId: withdrawal.id,
              fundedAccountId: withdrawal.fundedAccountId,
              userId: withdrawal.userId,
              amount: withdrawal.amount,
              stripePayoutId: payout.id,
              failureReason: payout.failure_message || 'Payout failed',
              correlationId,
              timestamp: Date.now(),
            }).catch((error) => {
              logger.error('Failed to publish withdrawal.failed event', {
                error: String(error),
                correlationId,
              });
            });
          } catch (error) {
            logger.error('Failed to process payout.failed', {
              error: String(error),
              payoutId: payout.id,
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Failed to process payout failure' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }

        // Return 200 to acknowledge webhook receipt
        return new Response(
          JSON.stringify({ received: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        logger.error('Webhook processing failed', { error: String(error), correlationId });
        return new Response(
          JSON.stringify({ error: 'Webhook processing failed' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    })
    .use(authMiddleware)
    // POST /purchases - Create a new purchase
    .post(
      '/purchases',
      async ({ body, userId }: { body: { tierId: string }; userId: string }) => {
        const correlationId = `purchase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        try {
          const { tierId } = body;

          logger.info('Purchase creation initiated', { userId, tierId, correlationId });

          // Validate tier exists
          const tier = await prisma.tier.findUnique({
            where: { id: tierId },
          });

          if (!tier) {
            logger.warn('Tier not found', { tierId, correlationId });
            return new Response(
              JSON.stringify({ error: 'Not Found', message: 'Tier not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Create Stripe Payment Intent
          let paymentIntent: Stripe.PaymentIntent;
          try {
            paymentIntent = await stripe.paymentIntents.create({
              amount: tier.price,
              currency: 'usd',
              metadata: {
                userId,
                tierId,
                correlationId,
              },
            });
            logger.info('Stripe Payment Intent created', {
              paymentIntentId: paymentIntent.id,
              amount: tier.price,
              correlationId,
            });
          } catch (stripeError) {
            logger.error('Failed to create Stripe Payment Intent', {
              error: String(stripeError),
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Payment Error', message: 'Failed to create payment intent' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Create purchase record in database
          let purchase;
          try {
            purchase = await retryWithBackoff(async () => {
              return await prisma.purchase.create({
                data: {
                  userId,
                  tierId,
                  stripePaymentId: paymentIntent.id,
                  status: 'pending',
                },
              });
            });
            logger.info('Purchase record created', {
              purchaseId: purchase.id,
              status: purchase.status,
              correlationId,
            });
          } catch (dbError) {
            logger.error('Failed to create purchase record', {
              error: String(dbError),
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Internal Server Error', message: 'Failed to create purchase' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Publish Kafka event (non-blocking)
          publishEvent('payment.purchase-initiated', {
            userId,
            tierId,
            purchaseId: purchase.id,
            amount: tier.price,
            correlationId,
            timestamp: Date.now(),
          }).catch((error) => {
            logger.error('Failed to publish purchase-initiated event', {
              error: String(error),
              correlationId,
            });
          });

          logger.info('Purchase creation completed', {
            purchaseId: purchase.id,
            correlationId,
          });

          return new Response(
            JSON.stringify({
              purchaseId: purchase.id,
              clientSecret: paymentIntent.client_secret,
              amount: tier.price,
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Purchase creation failed', { error: String(error), correlationId });
          return new Response(
            JSON.stringify({ error: 'Internal Server Error', message: 'Purchase creation failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      },
      {
        body: t.Object({
          tierId: t.String(),
        }),
      }
    )
    // GET /purchases/:id - Retrieve purchase details
    .get('/purchases/:id', async ({ params, userId }: { params: { id: string }; userId: string }) => {
      try {
        const { id } = params;

        logger.debug('Purchase retrieval initiated', { purchaseId: id, userId });

        // Query purchase with tier data
        const purchase = await prisma.purchase.findUnique({
          where: { id },
          include: {
            tier: true,
            assessments: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                startedAt: true,
                completedAt: true,
              },
            },
          },
        });

        if (!purchase) {
          logger.warn('Purchase not found', { purchaseId: id, userId });
          return new Response(
            JSON.stringify({ error: 'Not Found', message: 'Purchase not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Verify user owns the purchase
        if (purchase.userId !== userId) {
          logger.warn('Unauthorized purchase access attempt', {
            purchaseId: id,
            userId,
            ownerId: purchase.userId,
          });
          return new Response(
            JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        logger.debug('Purchase retrieved successfully', { purchaseId: id, userId });

        return new Response(
          JSON.stringify({
            purchase: {
              id: purchase.id,
              status: purchase.status,
              createdAt: purchase.createdAt,
              completedAt: purchase.completedAt,
              tier: {
                id: purchase.tier.id,
                name: purchase.tier.name,
                price: purchase.tier.price,
                startingBalance: purchase.tier.startingBalance,
                maxDrawdown: purchase.tier.maxDrawdown,
                minTrades: purchase.tier.minTrades,
                maxRiskPerTrade: purchase.tier.maxRiskPerTrade,
                profitSplit: purchase.tier.profitSplit,
              },
              assessments: purchase.assessments,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        logger.error('Failed to retrieve purchase', { error: String(error), userId });
        return new Response(
          JSON.stringify({ error: 'Internal Server Error', message: 'Failed to retrieve purchase' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    });
}
