import { Elysia, t } from 'elysia';
import { getPrismaClient } from '../db';
import { publishEvent } from '../utils/kafka';
import { createLogger } from '../utils/logger';
import { createAuthMiddleware } from '../middleware/auth';
import {
  getAssessmentState,
  updateAssessmentState,
  deleteAssessmentState,
  calculateDrawdown,
  updateAssessmentRules,
  AssessmentState,
  AssessmentRules,
} from '../utils/assessment-state';

const logger = createLogger('assessment-routes');

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

export function createAssessmentRoutes(jwtSecret: string) {
  const authMiddleware = createAuthMiddleware(jwtSecret);
  const prisma = getPrismaClient();

  return new Elysia()
    .use(authMiddleware)
    // POST /assessments - Create new assessment
    .post(
      '/assessments',
      async ({ body, userId }: { body: { purchaseId: string }; userId: string }): Promise<Response> => {
        const correlationId = `assessment-create-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        try {
          const { purchaseId } = body;

          logger.info('Creating assessment', { userId, purchaseId, correlationId });

          // Validate purchase exists and belongs to authenticated user
          const purchase = await prisma.purchase.findUnique({
            where: { id: purchaseId },
            include: { tier: true },
          });

          if (!purchase) {
            logger.warn('Purchase not found', { purchaseId, userId, correlationId });
            return new Response(
              JSON.stringify({ error: 'Not Found', message: 'Purchase not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify purchase belongs to authenticated user
          if (purchase.userId !== userId) {
            logger.warn('Unauthorized purchase access', {
              purchaseId,
              userId,
              ownerId: purchase.userId,
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify purchase status is "completed"
          if (purchase.status !== 'completed') {
            logger.warn('Purchase not completed', {
              purchaseId,
              status: purchase.status,
              correlationId,
            });
            return new Response(
              JSON.stringify({
                error: 'Conflict',
                message: 'Purchase must be completed before creating assessment',
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Check if assessment already exists for this purchase
          const existingAssessment = await prisma.assessment.findUnique({
            where: { purchaseId },
          });

          if (existingAssessment) {
            logger.warn('Assessment already exists for purchase', {
              purchaseId,
              assessmentId: existingAssessment.id,
              correlationId,
            });
            return new Response(
              JSON.stringify({
                error: 'Conflict',
                message: 'Assessment already exists for this purchase',
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Create assessment record with status "pending"
          const assessment = await prisma.assessment.create({
            data: {
              userId,
              tierId: purchase.tierId,
              purchaseId,
              status: 'pending',
            },
            include: { tier: true },
          });

          logger.info('Assessment created', {
            assessmentId: assessment.id,
            userId,
            purchaseId,
            correlationId,
          });

          // Publish Kafka event
          publishEvent('assessment.created', {
            assessmentId: assessment.id,
            userId,
            tierId: assessment.tierId,
            purchaseId,
            status: 'pending',
            correlationId,
            timestamp: Date.now(),
          }).catch((error) => {
            logger.error('Failed to publish assessment.created event', {
              error: String(error),
              correlationId,
            });
          });

          return new Response(
            JSON.stringify({
              assessment: {
                id: assessment.id,
                status: assessment.status,
                createdAt: assessment.createdAt,
                tier: {
                  id: assessment.tier.id,
                  name: assessment.tier.name,
                  startingBalance: assessment.tier.startingBalance,
                },
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to create assessment', {
            userId,
            error: String(error),
            correlationId,
          });
          return new Response(
            JSON.stringify({ error: 'Internal Server Error', message: 'Failed to create assessment' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      },
      {
        body: t.Object({
          purchaseId: t.String(),
        }),
      }
    )
    // GET /assessments - List all assessments for authenticated user
    .get('/assessments', async ({ userId }: { userId: string }): Promise<Response> => {
      try {
        logger.debug('Fetching assessments for user', { userId });

        const assessments = await prisma.assessment.findMany({
          where: { userId },
          include: {
            tier: true,
            virtualAccount: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        logger.info('Assessments retrieved', { userId, count: assessments.length });

        return new Response(
          JSON.stringify({
            assessments: assessments.map((assessment: any) => ({
              id: assessment.id,
              status: assessment.status,
              createdAt: assessment.createdAt,
              startedAt: assessment.startedAt,
              completedAt: assessment.completedAt,
              tier: {
                id: assessment.tier.id,
                name: assessment.tier.name,
                price: assessment.tier.price,
                startingBalance: assessment.tier.startingBalance,
                maxDrawdown: assessment.tier.maxDrawdown,
                minTrades: assessment.tier.minTrades,
                maxRiskPerTrade: assessment.tier.maxRiskPerTrade,
                profitSplit: assessment.tier.profitSplit,
              },
              virtualAccount: assessment.virtualAccount
                ? {
                    id: assessment.virtualAccount.id,
                    startingBalance: assessment.virtualAccount.startingBalance,
                    currentBalance: assessment.virtualAccount.currentBalance,
                    peakBalance: assessment.virtualAccount.peakBalance,
                    realizedPnl: assessment.virtualAccount.realizedPnl,
                    unrealizedPnl: assessment.virtualAccount.unrealizedPnl,
                  }
                : null,
            })),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        logger.error('Failed to retrieve assessments', { userId, error: String(error) });
        return new Response(
          JSON.stringify({ error: 'Internal Server Error', message: 'Failed to retrieve assessments' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    })
    // GET /assessments/:id - Retrieve single assessment details
    .get('/assessments/:id', async ({ params, userId }: { params: { id: string }; userId: string }): Promise<Response> => {
      try {
        const { id } = params;
        const correlationId = `assessment-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        logger.debug('Fetching assessment', { assessmentId: id, userId, correlationId });

        // Query assessment from database
        const assessment = await prisma.assessment.findUnique({
          where: { id },
          include: {
            tier: true,
            virtualAccount: true,
          },
        });

        if (!assessment) {
          logger.warn('Assessment not found', { assessmentId: id, userId, correlationId });
          return new Response(
            JSON.stringify({ error: 'Not Found', message: 'Assessment not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Verify user owns the assessment
        if (assessment.userId !== userId) {
          logger.warn('Unauthorized assessment access', {
            assessmentId: id,
            userId,
            ownerId: assessment.userId,
            correlationId,
          });
          return new Response(
            JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Check Redis hot path for real-time data
        let redisState: AssessmentState | null = null;
        if (assessment.status === 'active' || assessment.status === 'paused') {
          redisState = await getAssessmentState(id);
        }

        logger.debug('Assessment retrieved', { assessmentId: id, userId, correlationId });

        return new Response(
          JSON.stringify({
            assessment: {
              id: assessment.id,
              status: assessment.status,
              createdAt: assessment.createdAt,
              startedAt: assessment.startedAt,
              completedAt: assessment.completedAt,
              tier: {
                id: assessment.tier.id,
                name: assessment.tier.name,
                price: assessment.tier.price,
                startingBalance: assessment.tier.startingBalance,
                maxDrawdown: assessment.tier.maxDrawdown,
                minTrades: assessment.tier.minTrades,
                maxRiskPerTrade: assessment.tier.maxRiskPerTrade,
                profitSplit: assessment.tier.profitSplit,
              },
              virtualAccount: assessment.virtualAccount
                ? {
                    id: assessment.virtualAccount.id,
                    startingBalance: assessment.virtualAccount.startingBalance,
                    currentBalance: redisState?.currentBalance ?? assessment.virtualAccount.currentBalance,
                    peakBalance: redisState?.peakBalance ?? assessment.virtualAccount.peakBalance,
                    realizedPnl: redisState?.realizedPnl ?? assessment.virtualAccount.realizedPnl,
                    unrealizedPnl: redisState?.unrealizedPnl ?? assessment.virtualAccount.unrealizedPnl,
                  }
                : null,
              redisState: redisState || undefined,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        logger.error('Failed to retrieve assessment', { userId, error: String(error) });
        return new Response(
          JSON.stringify({ error: 'Internal Server Error', message: 'Failed to retrieve assessment' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    })
    // POST /assessments/:id/start - Start assessment and initialize virtual account
    .post(
      '/assessments/:id/start',
      async ({ params, userId }: { params: { id: string }; userId: string }): Promise<Response> => {
        const { id } = params;
        const correlationId = `assessment-start-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        try {
          logger.info('Starting assessment', { assessmentId: id, userId, correlationId });

          // Fetch assessment
          const assessment = await prisma.assessment.findUnique({
            where: { id },
            include: { tier: true },
          });

          if (!assessment) {
            logger.warn('Assessment not found', { assessmentId: id, userId, correlationId });
            return new Response(
              JSON.stringify({ error: 'Not Found', message: 'Assessment not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify user owns the assessment
          if (assessment.userId !== userId) {
            logger.warn('Unauthorized assessment access', {
              assessmentId: id,
              userId,
              ownerId: assessment.userId,
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify assessment status is "pending"
          if (assessment.status !== 'pending') {
            logger.warn('Invalid assessment status for start', {
              assessmentId: id,
              status: assessment.status,
              correlationId,
            });
            return new Response(
              JSON.stringify({
                error: 'Conflict',
                message: 'Assessment can only be started from pending status',
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Begin transaction
          const result = await retryWithBackoff(async () => {
            return await prisma.$transaction(async (tx: any) => {
              // Update assessment status to "active"
              const updatedAssessment = await tx.assessment.update({
                where: { id },
                data: {
                  status: 'active',
                  startedAt: new Date(),
                },
              });

              logger.info('Assessment status updated to active', {
                assessmentId: id,
                correlationId,
              });

              // Create VirtualAccount record
              const virtualAccount = await tx.virtualAccount.create({
                data: {
                  assessmentId: id,
                  startingBalance: assessment.tier.startingBalance,
                  currentBalance: assessment.tier.startingBalance,
                  peakBalance: assessment.tier.startingBalance,
                  realizedPnl: 0,
                  unrealizedPnl: 0,
                },
              });

              logger.info('Virtual account created', {
                assessmentId: id,
                virtualAccountId: virtualAccount.id,
                startingBalance: assessment.tier.startingBalance,
                correlationId,
              });

              return { assessment: updatedAssessment, virtualAccount };
            });
          });

          // Initialize Redis hot path
          const initialState: AssessmentState = {
            currentBalance: assessment.tier.startingBalance,
            peakBalance: assessment.tier.startingBalance,
            realizedPnl: 0,
            unrealizedPnl: 0,
            tradeCount: 0,
            positions: [],
          };

          await updateAssessmentState(id, initialState);
          logger.info('Redis state initialized', { assessmentId: id, correlationId });

          // Initialize Redis rules tracking
          const initialRules: AssessmentRules = {
            drawdown: {
              value: 0,
              threshold: assessment.tier.maxDrawdown,
              status: 'safe',
            },
            tradeCount: {
              value: 0,
              threshold: assessment.tier.minTrades,
              status: 'safe',
            },
            riskPerTrade: {
              value: 0,
              threshold: assessment.tier.maxRiskPerTrade,
              status: 'safe',
            },
          };

          await updateAssessmentRules(id, initialRules);
          logger.info('Redis rules initialized', { assessmentId: id, correlationId });

          // Publish Kafka event
          publishEvent('assessment.started', {
            assessmentId: id,
            userId,
            tierId: assessment.tierId,
            startingBalance: assessment.tier.startingBalance,
            correlationId,
            timestamp: Date.now(),
          }).catch((error) => {
            logger.error('Failed to publish assessment.started event', {
              error: String(error),
              correlationId,
            });
          });

          logger.info('Assessment started successfully', { assessmentId: id, userId, correlationId });

          return new Response(
            JSON.stringify({
              assessment: {
                id: result.assessment.id,
                status: result.assessment.status,
                startedAt: result.assessment.startedAt,
                tier: {
                  id: assessment.tier.id,
                  name: assessment.tier.name,
                  startingBalance: assessment.tier.startingBalance,
                },
                virtualAccount: {
                  id: result.virtualAccount.id,
                  startingBalance: result.virtualAccount.startingBalance,
                  currentBalance: result.virtualAccount.currentBalance,
                  peakBalance: result.virtualAccount.peakBalance,
                  realizedPnl: result.virtualAccount.realizedPnl,
                  unrealizedPnl: result.virtualAccount.unrealizedPnl,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to start assessment', {
            assessmentId: id,
            userId,
            error: String(error),
            correlationId,
          });
          return new Response(
            JSON.stringify({ error: 'Internal Server Error', message: 'Failed to start assessment' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // POST /assessments/:id/pause - Pause active assessment
    .post(
      '/assessments/:id/pause',
      async ({ params, userId }: { params: { id: string }; userId: string }): Promise<Response> => {
        const { id } = params;
        const correlationId = `assessment-pause-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        try {
          logger.info('Pausing assessment', { assessmentId: id, userId, correlationId });

          // Fetch assessment
          const assessment = await prisma.assessment.findUnique({
            where: { id },
            include: { virtualAccount: true },
          });

          if (!assessment) {
            logger.warn('Assessment not found', { assessmentId: id, userId, correlationId });
            return new Response(
              JSON.stringify({ error: 'Not Found', message: 'Assessment not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify user owns the assessment
          if (assessment.userId !== userId) {
            logger.warn('Unauthorized assessment access', {
              assessmentId: id,
              userId,
              ownerId: assessment.userId,
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify assessment status is "active"
          if (assessment.status !== 'active') {
            logger.warn('Invalid assessment status for pause', {
              assessmentId: id,
              status: assessment.status,
              correlationId,
            });
            return new Response(
              JSON.stringify({
                error: 'Conflict',
                message: 'Only active assessments can be paused',
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Update assessment status to "paused"
          const updatedAssessment = await prisma.assessment.update({
            where: { id },
            data: { status: 'paused' },
          });

          logger.info('Assessment status updated to paused', { assessmentId: id, correlationId });

          // Publish Kafka event
          publishEvent('assessment.paused', {
            assessmentId: id,
            userId,
            correlationId,
            timestamp: Date.now(),
          }).catch((error) => {
            logger.error('Failed to publish assessment.paused event', {
              error: String(error),
              correlationId,
            });
          });

          logger.info('Assessment paused successfully', { assessmentId: id, userId, correlationId });

          return new Response(
            JSON.stringify({
              assessment: {
                id: updatedAssessment.id,
                status: updatedAssessment.status,
                virtualAccount: assessment.virtualAccount
                  ? {
                      id: assessment.virtualAccount.id,
                      currentBalance: assessment.virtualAccount.currentBalance,
                      peakBalance: assessment.virtualAccount.peakBalance,
                      realizedPnl: assessment.virtualAccount.realizedPnl,
                      unrealizedPnl: assessment.virtualAccount.unrealizedPnl,
                    }
                  : null,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to pause assessment', {
            assessmentId: id,
            userId,
            error: String(error),
            correlationId,
          });
          return new Response(
            JSON.stringify({ error: 'Internal Server Error', message: 'Failed to pause assessment' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // POST /assessments/:id/resume - Resume paused assessment
    .post(
      '/assessments/:id/resume',
      async ({ params, userId }: { params: { id: string }; userId: string }): Promise<Response> => {
        const { id } = params;
        const correlationId = `assessment-resume-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        try {
          logger.info('Resuming assessment', { assessmentId: id, userId, correlationId });

          // Fetch assessment
          const assessment = await prisma.assessment.findUnique({
            where: { id },
            include: { virtualAccount: true },
          });

          if (!assessment) {
            logger.warn('Assessment not found', { assessmentId: id, userId, correlationId });
            return new Response(
              JSON.stringify({ error: 'Not Found', message: 'Assessment not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify user owns the assessment
          if (assessment.userId !== userId) {
            logger.warn('Unauthorized assessment access', {
              assessmentId: id,
              userId,
              ownerId: assessment.userId,
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify assessment status is "paused"
          if (assessment.status !== 'paused') {
            logger.warn('Invalid assessment status for resume', {
              assessmentId: id,
              status: assessment.status,
              correlationId,
            });
            return new Response(
              JSON.stringify({
                error: 'Conflict',
                message: 'Only paused assessments can be resumed',
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Update assessment status to "active"
          const updatedAssessment = await prisma.assessment.update({
            where: { id },
            data: { status: 'active' },
          });

          logger.info('Assessment status updated to active', { assessmentId: id, correlationId });

          // Publish Kafka event
          publishEvent('assessment.resumed', {
            assessmentId: id,
            userId,
            correlationId,
            timestamp: Date.now(),
          }).catch((error) => {
            logger.error('Failed to publish assessment.resumed event', {
              error: String(error),
              correlationId,
            });
          });

          logger.info('Assessment resumed successfully', { assessmentId: id, userId, correlationId });

          return new Response(
            JSON.stringify({
              assessment: {
                id: updatedAssessment.id,
                status: updatedAssessment.status,
                virtualAccount: assessment.virtualAccount
                  ? {
                      id: assessment.virtualAccount.id,
                      currentBalance: assessment.virtualAccount.currentBalance,
                      peakBalance: assessment.virtualAccount.peakBalance,
                      realizedPnl: assessment.virtualAccount.realizedPnl,
                      unrealizedPnl: assessment.virtualAccount.unrealizedPnl,
                    }
                  : null,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to resume assessment', {
            assessmentId: id,
            userId,
            error: String(error),
            correlationId,
          });
          return new Response(
            JSON.stringify({ error: 'Internal Server Error', message: 'Failed to resume assessment' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // POST /assessments/:id/abandon - Abandon assessment and close positions
    .post(
      '/assessments/:id/abandon',
      async ({ params, userId }: { params: { id: string }; userId: string }): Promise<Response> => {
        const { id } = params;
        const correlationId = `assessment-abandon-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        try {
          logger.info('Abandoning assessment', { assessmentId: id, userId, correlationId });

          // Fetch assessment
          const assessment = await prisma.assessment.findUnique({
            where: { id },
            include: { virtualAccount: true },
          });

          if (!assessment) {
            logger.warn('Assessment not found', { assessmentId: id, userId, correlationId });
            return new Response(
              JSON.stringify({ error: 'Not Found', message: 'Assessment not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify user owns the assessment
          if (assessment.userId !== userId) {
            logger.warn('Unauthorized assessment access', {
              assessmentId: id,
              userId,
              ownerId: assessment.userId,
              correlationId,
            });
            return new Response(
              JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify assessment status is "active" or "paused"
          if (assessment.status !== 'active' && assessment.status !== 'paused') {
            logger.warn('Invalid assessment status for abandon', {
              assessmentId: id,
              status: assessment.status,
              correlationId,
            });
            return new Response(
              JSON.stringify({
                error: 'Conflict',
                message: 'Only active or paused assessments can be abandoned',
              }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Fetch Redis state to get positions
          const redisState = await getAssessmentState(id);
          let finalBalance = assessment.virtualAccount?.currentBalance ?? 0;
          let finalPnl = (assessment.virtualAccount?.realizedPnl ?? 0) + (assessment.virtualAccount?.unrealizedPnl ?? 0);

          if (redisState) {
            finalBalance = redisState.currentBalance;
            finalPnl = redisState.realizedPnl + redisState.unrealizedPnl;
          }

          // Begin transaction
          await retryWithBackoff(async () => {
            return await prisma.$transaction(async (tx: any) => {
              // Update assessment status to "abandoned"
              await tx.assessment.update({
                where: { id },
                data: {
                  status: 'abandoned',
                  completedAt: new Date(),
                  deletedAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
                },
              });

              logger.info('Assessment status updated to abandoned', { assessmentId: id, correlationId });

              // Update VirtualAccount with final balances before deleting Redis state
              await tx.virtualAccount.update({
                where: { assessmentId: id },
                data: {
                  currentBalance: finalBalance,
                  realizedPnl: redisState?.realizedPnl ?? (assessment.virtualAccount?.realizedPnl ?? 0),
                  unrealizedPnl: redisState?.unrealizedPnl ?? (assessment.virtualAccount?.unrealizedPnl ?? 0),
                  updatedAt: new Date(),
                },
              });

              logger.info('Virtual account updated with final balances', {
                assessmentId: id,
                finalBalance,
                finalPnl,
                correlationId,
              });

              // Close all open positions
              // First, try to get positions from Redis state
              if (redisState && redisState.positions.length > 0) {
                for (const position of redisState.positions) {
                  // Create Trade record for position closure
                  await tx.trade.create({
                    data: {
                      assessmentId: id,
                      positionId: position.id,
                      type: 'close',
                      market: position.market,
                      side: position.side === 'long' ? 'sell' : 'buy',
                      quantity: position.quantity,
                      price: position.currentPrice,
                      slippage: 0,
                      fee: 0,
                      pnl: position.unrealizedPnl,
                    },
                  });

                  // Update Position record with closedAt
                  await tx.position.update({
                    where: { id: position.id },
                    data: { closedAt: new Date() },
                  });

                  logger.debug('Position closed', {
                    assessmentId: id,
                    positionId: position.id,
                    correlationId,
                  });
                }
              } else {
                // Fallback: close any open positions from database if Redis state is missing
                const openPositions = await tx.position.findMany({
                  where: {
                    assessmentId: id,
                    closedAt: null,
                  },
                });

                for (const position of openPositions) {
                  // Create Trade record for position closure
                  await tx.trade.create({
                    data: {
                      assessmentId: id,
                      positionId: position.id,
                      type: 'close',
                      market: position.market,
                      side: position.side === 'long' ? 'sell' : 'buy',
                      quantity: position.quantity,
                      price: position.currentPrice,
                      slippage: 0,
                      fee: 0,
                      pnl: position.unrealizedPnl,
                    },
                  });

                  // Update Position record with closedAt
                  await tx.position.update({
                    where: { id: position.id },
                    data: { closedAt: new Date() },
                  });

                  logger.debug('Position closed (from DB fallback)', {
                    assessmentId: id,
                    positionId: position.id,
                    correlationId,
                  });
                }
              }

              return true;
            });
          });

          // Fetch persisted virtual account to return accurate values
          const persistedVirtualAccount = await prisma.virtualAccount.findUnique({
            where: { assessmentId: id },
          });

          if (persistedVirtualAccount) {
            finalBalance = persistedVirtualAccount.currentBalance;
            finalPnl = persistedVirtualAccount.realizedPnl + persistedVirtualAccount.unrealizedPnl;
          }

          // Delete Redis state after persisting to database
          await deleteAssessmentState(id);
          logger.info('Redis state deleted', { assessmentId: id, correlationId });

          // Publish Kafka event
          publishEvent('assessment.abandoned', {
            assessmentId: id,
            userId,
            finalBalance,
            finalPnl,
            correlationId,
            timestamp: Date.now(),
          }).catch((error) => {
            logger.error('Failed to publish assessment.abandoned event', {
              error: String(error),
              correlationId,
            });
          });

          // Publish assessment.completed event (abandoned is a terminal state)
          publishEvent('assessment.completed', {
            assessmentId: id,
            userId,
            status: 'abandoned',
            finalBalance,
            finalPnl,
            correlationId,
            timestamp: Date.now(),
          }).catch((error) => {
            logger.error('Failed to publish assessment.completed event', {
              error: String(error),
              correlationId,
            });
          });

          logger.info('Assessment abandoned successfully', {
            assessmentId: id,
            userId,
            finalBalance,
            finalPnl,
            correlationId,
          });

          return new Response(
            JSON.stringify({
              assessment: {
                id,
                status: 'abandoned',
                completedAt: new Date(),
                finalBalance,
                finalPnl,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to abandon assessment', {
            assessmentId: id,
            userId,
            error: String(error),
            correlationId,
          });
          return new Response(
            JSON.stringify({ error: 'Internal Server Error', message: 'Failed to abandon assessment' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    );
}
