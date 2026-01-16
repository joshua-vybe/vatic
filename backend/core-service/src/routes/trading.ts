import { Elysia, t } from 'elysia';
import { v4 as uuid } from 'uuid';
import { getPrismaClient } from '../db';
import { getAssessmentState, updateAssessmentState } from '../utils/assessment-state';
import { getMarketPrice, calculateCryptoPnL, calculatePredictionMarketUnrealizedPnL, getMarketType } from '../utils/trading';
import { executeOrderPlacementSaga } from '../sagas/order-placement-saga';
import { publishEvent } from '../utils/kafka';
import { getRedisClient } from '../utils/redis';
import { createLogger } from '../utils/logger';
import { createAuthMiddleware } from '../middleware/auth';

const logger = createLogger('trading-routes');

export interface TradingConfig {
  jwtSecret: string;
  cryptoSlippage: number;
  cryptoFee: number;
  predictionSlippage: number;
  predictionFee: number;
}

export function createTradingRoutes(config: TradingConfig) {
  const authMiddleware = createAuthMiddleware(config.jwtSecret);
  const prisma = getPrismaClient();

  return new Elysia()
    .use(authMiddleware)
    // POST /orders - Place a new order
    .post(
      '/orders',
      async ({
        body,
        userId,
      }: {
        body: { assessmentId: string; market: string; side: string; quantity: number };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const { assessmentId, market, side, quantity } = body;

        try {
          logger.info('Order placement request received', {
            correlationId,
            assessmentId,
            market,
            side,
            quantity,
            userId,
          });

          // Validate request body
          if (!assessmentId || !market || !side || !quantity) {
            logger.warn('Invalid order request', {
              correlationId,
              missing: {
                assessmentId: !assessmentId,
                market: !market,
                side: !side,
                quantity: !quantity,
              },
            });
            return new Response(
              JSON.stringify({
                error: 'Invalid request',
                message: 'Missing required fields: assessmentId, market, side, quantity',
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (typeof quantity !== 'number' || quantity <= 0) {
            return new Response(
              JSON.stringify({
                error: 'Invalid quantity',
                message: 'Quantity must be a positive number',
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Validate side against market type
          const marketType = getMarketType(market);
          const validSides = marketType === 'crypto' ? ['long', 'short'] : ['yes', 'no'];

          if (!validSides.includes(side)) {
            logger.warn('Invalid side for market type', {
              correlationId,
              market,
              marketType,
              side,
              validSides,
            });
            return new Response(
              JSON.stringify({
                error: 'Invalid side',
                message: `Side must be one of ${validSides.join(', ')} for ${marketType} markets`,
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify user owns assessment
          const assessment = await prisma.assessment.findUnique({
            where: { id: assessmentId },
          });

          if (!assessment) {
            logger.warn('Assessment not found', { correlationId, assessmentId, userId });
            return new Response(
              JSON.stringify({
                error: 'Assessment not found',
                message: 'The specified assessment does not exist',
                correlationId,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Verify user owns the assessment
          if (assessment.userId !== userId) {
            logger.warn('Unauthorized assessment access', {
              correlationId,
              assessmentId,
              userId,
              ownerId: assessment.userId,
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

          // Verify assessment is active
          if (assessment.status !== 'active') {
            logger.warn('Assessment not active', {
              correlationId,
              assessmentId,
              status: assessment.status,
            });
            return new Response(
              JSON.stringify({
                error: 'Assessment not active',
                message: `Assessment status is ${assessment.status}`,
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Execute order placement saga
          const result = await executeOrderPlacementSaga(assessmentId, market, side, quantity, {
            cryptoSlippage: config.cryptoSlippage,
            cryptoFee: config.cryptoFee,
            predictionSlippage: config.predictionSlippage,
            predictionFee: config.predictionFee,
          }, correlationId);

          if (!result.success) {
            const statusCode = result.error === 'Market data unavailable' ? 503 : 400;
            logger.warn('Order placement failed', {
              correlationId,
              error: result.error,
              message: result.message,
            });
            return new Response(
              JSON.stringify({
                error: result.error,
                message: result.message,
                correlationId,
              }),
              { status: statusCode, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Check if assessment failed due to drawdown
          if (result.status === 'failed') {
            logger.info('Order placed but assessment failed', {
              correlationId,
              assessmentId,
              reason: result.reason,
            });
            return new Response(
              JSON.stringify({
                status: 'failed',
                reason: result.reason,
                assessment: {
                  id: assessmentId,
                  status: 'failed',
                },
                correlationId,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }

          logger.info('Order placed successfully', {
            correlationId,
            assessmentId,
            orderId: result.orderId,
            balance: result.balance,
          });

          return new Response(
            JSON.stringify({
              orderId: result.orderId,
              position: result.position,
              balance: result.balance,
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Order placement error', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to process order',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // GET /positions - Get open positions for an assessment
    .get(
      '/positions',
      async ({
        query,
        userId,
      }: {
        query: { assessmentId: string };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const { assessmentId } = query;

        try {
          if (!assessmentId) {
            return new Response(
              JSON.stringify({
                error: 'Invalid request',
                message: 'assessmentId query parameter is required',
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          logger.debug('Fetching positions', { correlationId, assessmentId, userId });

          // Verify assessment exists and user owns it
          const assessment = await prisma.assessment.findUnique({
            where: { id: assessmentId },
          });

          if (!assessment) {
            return new Response(
              JSON.stringify({
                error: 'Assessment not found',
                message: 'The specified assessment does not exist',
                correlationId,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (assessment.userId !== userId) {
            logger.warn('Unauthorized assessment access', {
              correlationId,
              assessmentId,
              userId,
              ownerId: assessment.userId,
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

          // Try to fetch from Redis first
          let positions = [];
          const assessmentState = await getAssessmentState(assessmentId);

          if (assessmentState && assessmentState.positions) {
            positions = assessmentState.positions;
          } else {
            // Fallback to database
            const dbPositions = await prisma.position.findMany({
              where: {
                assessmentId,
                closedAt: null,
              },
            });
            positions = dbPositions;
          }

          // Enrich positions with current market prices and recalculated P&L
          const enrichedPositions = await Promise.all(
            positions.map(async (position: any) => {
              const marketPrice = await getMarketPrice(position.market);
              let currentPrice = position.currentPrice;
              let unrealizedPnl = position.unrealizedPnl;

              if (marketPrice !== null) {
                if (typeof marketPrice === 'object') {
                  // Prediction market
                  currentPrice = position.side === 'yes' ? marketPrice.yes : marketPrice.no;
                  unrealizedPnl = calculatePredictionMarketUnrealizedPnL(
                    position.side,
                    position.quantity,
                    position.entryPrice,
                    currentPrice
                  );
                } else {
                  // Crypto market
                  currentPrice = marketPrice;
                  unrealizedPnl = calculateCryptoPnL(
                    position.side,
                    position.quantity,
                    position.entryPrice,
                    currentPrice
                  );
                }
              }

              return {
                id: position.id,
                market: position.market,
                side: position.side,
                quantity: position.quantity,
                entryPrice: position.entryPrice,
                currentPrice,
                unrealizedPnl,
                openedAt: position.openedAt,
              };
            })
          );

          logger.debug('Positions fetched', {
            correlationId,
            assessmentId,
            count: enrichedPositions.length,
          });

          return new Response(
            JSON.stringify({
              positions: enrichedPositions,
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to fetch positions', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to fetch positions',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // GET /trades - Get trade history for an assessment
    .get(
      '/trades',
      async ({
        query,
        userId,
      }: {
        query: { assessmentId: string; limit?: string; offset?: string };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const { assessmentId, limit = '50', offset = '0' } = query;

        try {
          if (!assessmentId) {
            return new Response(
              JSON.stringify({
                error: 'Invalid request',
                message: 'assessmentId query parameter is required',
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          const limitNum = Math.min(parseInt(limit) || 50, 100);
          const offsetNum = parseInt(offset) || 0;

          logger.debug('Fetching trades', {
            correlationId,
            assessmentId,
            limit: limitNum,
            offset: offsetNum,
            userId,
          });

          // Verify assessment exists and user owns it
          const assessment = await prisma.assessment.findUnique({
            where: { id: assessmentId },
          });

          if (!assessment) {
            return new Response(
              JSON.stringify({
                error: 'Assessment not found',
                message: 'The specified assessment does not exist',
                correlationId,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (assessment.userId !== userId) {
            logger.warn('Unauthorized assessment access', {
              correlationId,
              assessmentId,
              userId,
              ownerId: assessment.userId,
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

          // Fetch trades from database
          const [trades, total] = await Promise.all([
            prisma.trade.findMany({
              where: { assessmentId },
              orderBy: { timestamp: 'desc' },
              take: limitNum,
              skip: offsetNum,
            }),
            prisma.trade.count({
              where: { assessmentId },
            }),
          ]);

          logger.debug('Trades fetched', {
            correlationId,
            assessmentId,
            count: trades.length,
            total,
          });

          return new Response(
            JSON.stringify({
              trades: trades.map((trade: any) => ({
                id: trade.id,
                type: trade.type,
                market: trade.market,
                side: trade.side,
                quantity: trade.quantity,
                price: trade.price,
                slippage: trade.slippage,
                fee: trade.fee,
                pnl: trade.pnl,
                timestamp: trade.timestamp,
              })),
              total,
              limit: limitNum,
              offset: offsetNum,
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to fetch trades', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to fetch trades',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // POST /positions/:id/close - Close a position manually
    .post(
      '/positions/:id/close',
      async ({
        params,
        userId,
      }: {
        params: { id: string };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const positionId = params.id;

        try {
          logger.info('Position close request received', {
            correlationId,
            positionId,
            userId,
          });

          // Fetch position from database
          let position = await prisma.position.findUnique({
            where: { id: positionId },
            include: { assessment: true },
          });

          // Fallback to Redis state if DB position not found (handles race condition during position opening)
          if (!position) {
            logger.debug('Position not found in DB, checking Redis state', {
              correlationId,
              positionId,
            });

            // Try to find position in Redis state
            const redis = getRedisClient();
            if (redis) {
              // Scan all assessment states to find the position
              let cursor = '0';
              let foundPosition = null;
              let foundAssessmentId = null;

              do {
                const result = await redis.scan(cursor, 'MATCH', 'assessment:*:state', 'COUNT', '100');
                cursor = result[0];
                const keys = result[1];

                for (const key of keys) {
                  const match = key.match(/^assessment:(.+):state$/);
                  if (match) {
                    const assessmentId = match[1];
                    const stateJson = await redis.get(key);
                    if (stateJson) {
                      const state = JSON.parse(stateJson);
                      const pos = state.positions?.find((p: any) => p.id === positionId);
                      if (pos) {
                        foundPosition = pos;
                        foundAssessmentId = assessmentId;
                        break;
                      }
                    }
                  }
                }

                if (foundPosition) break;
              } while (cursor !== '0');

              if (foundPosition && foundAssessmentId) {
                logger.info('Position found in Redis state, using fallback', {
                  correlationId,
                  positionId,
                  assessmentId: foundAssessmentId,
                });

                // Construct position object from Redis data
                position = {
                  id: foundPosition.id,
                  assessmentId: foundAssessmentId,
                  market: foundPosition.market,
                  side: foundPosition.side,
                  quantity: foundPosition.quantity,
                  entryPrice: foundPosition.entryPrice,
                  currentPrice: foundPosition.currentPrice,
                  openedAt: foundPosition.openedAt,
                  closedAt: null,
                  assessment: {
                    id: foundAssessmentId,
                    userId: userId, // Will verify below
                  },
                } as any;
              }
            }

            if (!position) {
              logger.warn('Position not found in DB or Redis', { correlationId, positionId, userId });
              return new Response(
                JSON.stringify({
                  error: 'Position not found',
                  message: 'The specified position does not exist',
                  correlationId,
                }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
              );
            }
          }

          // Verify user owns the assessment
          if (position.assessment.userId !== userId) {
            logger.warn('Unauthorized position access', {
              correlationId,
              positionId,
              userId,
              ownerId: position.assessment.userId,
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

          const assessmentId = position.assessmentId;

          // Verify assessment is active
          const assessment = await prisma.assessment.findUnique({
            where: { id: assessmentId },
          });

          if (!assessment || assessment.status !== 'active') {
            logger.warn('Assessment not active', {
              correlationId,
              assessmentId,
              status: assessment?.status,
            });
            return new Response(
              JSON.stringify({
                error: 'Assessment not active',
                message: 'Cannot close positions on inactive assessment',
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Fetch current market price
          const marketPrice = await getMarketPrice(position.market);
          if (marketPrice === null) {
            logger.error('Market price unavailable', { correlationId, market: position.market });
            return new Response(
              JSON.stringify({
                error: 'Market data unavailable',
                message: `Unable to fetch price for market ${position.market}`,
                correlationId,
              }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Determine exit price based on market type
          let exitPrice: number;
          if (typeof marketPrice === 'object') {
            // Prediction market
            exitPrice = position.side === 'yes' ? marketPrice.yes : marketPrice.no;
          } else {
            // Crypto market
            exitPrice = marketPrice;
          }

          // Calculate realized P&L based on market type
          let realizedPnl = 0;
          const marketType = getMarketType(position.market);

          if (marketType === 'crypto') {
            // Crypto: Long = (exit - entry) * qty, Short = (entry - exit) * qty
            if (position.side === 'long') {
              realizedPnl = (exitPrice - position.entryPrice) * position.quantity;
            } else {
              realizedPnl = (position.entryPrice - exitPrice) * position.quantity;
            }
          } else {
            // Prediction market: Yes = (exit - entry) * qty, No = (entry - exit) * qty
            if (position.side === 'yes') {
              realizedPnl = (exitPrice - position.entryPrice) * position.quantity;
            } else {
              realizedPnl = (position.entryPrice - exitPrice) * position.quantity;
            }
          }

          // Get assessment state from Redis
          const assessmentState = await getAssessmentState(assessmentId);
          if (!assessmentState) {
            logger.error('Assessment state not found', { correlationId, assessmentId });
            return new Response(
              JSON.stringify({
                error: 'Assessment state unavailable',
                message: 'Failed to fetch assessment state',
                correlationId,
              }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Remove position from Redis state
          const updatedPositions = assessmentState.positions.filter((p) => p.id !== positionId);
          const positionSize = position.quantity * position.entryPrice;
          const newBalance = assessmentState.currentBalance + positionSize + realizedPnl;

          // Update assessment state in Redis
          const updatedState = {
            ...assessmentState,
            currentBalance: newBalance,
            positions: updatedPositions,
            realizedPnl: (assessmentState.realizedPnl || 0) + realizedPnl,
            tradeCount: (assessmentState.tradeCount || 0) + 1,
          };

          const updateSuccess = await updateAssessmentState(assessmentId, updatedState);
          if (!updateSuccess) {
            logger.error('Failed to update assessment state', { correlationId, assessmentId });
            return new Response(
              JSON.stringify({
                error: 'State update failed',
                message: 'Failed to persist position closure',
                correlationId,
              }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Update peak balance if new balance exceeds current peak
          if (newBalance > assessmentState.peakBalance) {
            updatedState.peakBalance = newBalance;
            await updateAssessmentState(assessmentId, updatedState);
          }

          // Create 'close' trade record in database
          await prisma.trade.create({
            data: {
              assessmentId,
              positionId,
              type: 'close',
              market: position.market,
              side: position.side,
              quantity: position.quantity,
              price: exitPrice,
              slippage: 0,
              fee: 0,
              pnl: realizedPnl,
            },
          });

          // Update position closed_at timestamp (only if it exists in DB)
          if (position.id) {
            await prisma.position.update({
              where: { id: positionId },
              data: { closedAt: new Date() },
            }).catch((error: any) => {
              logger.warn('Failed to update position closedAt in database', {
                correlationId,
                positionId,
                error: String(error),
              });
            });
          }

          // Publish Kafka events
          await publishEvent('trading.position-closed', {
            assessmentId,
            positionId,
            market: position.market,
            side: position.side,
            quantity: position.quantity,
            entryPrice: position.entryPrice,
            exitPrice,
            correlationId,
            timestamp: new Date(),
          });

          await publishEvent('trading.trade-completed', {
            assessmentId,
            positionId,
            market: position.market,
            side: position.side,
            quantity: position.quantity,
            entryPrice: position.entryPrice,
            exitPrice,
            realizedPnl,
            correlationId,
            timestamp: new Date(),
          });

          logger.info('Position closed successfully', {
            correlationId,
            assessmentId,
            positionId,
            realizedPnl,
            newBalance,
          });

          return new Response(
            JSON.stringify({
              positionId,
              realizedPnl,
              balance: newBalance,
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          logger.error('Position close error', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to close position',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    )
    // GET /rules - Get current rule status
    .get(
      '/rules',
      async ({
        query,
        userId,
      }: {
        query: { assessmentId: string };
        userId: string;
      }): Promise<Response> => {
        const correlationId = uuid();
        const { assessmentId } = query;

        try {
          if (!assessmentId) {
            return new Response(
              JSON.stringify({
                error: 'Invalid request',
                message: 'assessmentId query parameter is required',
                correlationId,
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          logger.debug('Fetching rules', { correlationId, assessmentId, userId });

          // Verify assessment exists and user owns it
          const assessment = await prisma.assessment.findUnique({
            where: { id: assessmentId },
          });

          if (!assessment) {
            return new Response(
              JSON.stringify({
                error: 'Assessment not found',
                message: 'The specified assessment does not exist',
                correlationId,
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          if (assessment.userId !== userId) {
            logger.warn('Unauthorized assessment access', {
              correlationId,
              assessmentId,
              userId,
              ownerId: assessment.userId,
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

          // Fetch rules from Redis
          const redis = getRedisClient();
          let rules = null;

          if (redis) {
            const rulesJson = await redis.get(`assessment:${assessmentId}:rules`);
            if (rulesJson) {
              rules = JSON.parse(rulesJson);
            }
          }

          // If not in Redis, calculate on-demand
          if (!rules) {
            const { calculateAssessmentRules } = await import('../utils/rules-monitoring');
            rules = await calculateAssessmentRules(assessmentId);
          }

          logger.debug('Rules fetched', {
            correlationId,
            assessmentId,
            drawdownStatus: rules.drawdown.status,
            tradeCountStatus: rules.tradeCount.status,
            riskPerTradeStatus: rules.riskPerTrade.status,
          });

          return new Response(
            JSON.stringify({
              drawdown: rules.drawdown,
              tradeCount: rules.tradeCount,
              riskPerTrade: rules.riskPerTrade,
              correlationId,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Failed to fetch rules', {
            correlationId,
            error: String(error),
          });
          return new Response(
            JSON.stringify({
              error: 'Internal server error',
              message: 'Failed to fetch rules',
              correlationId,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    );
}
