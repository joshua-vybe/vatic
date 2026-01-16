import './utils/tracing';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { context, propagation } from '@opentelemetry/api';
import { loadConfig } from './config';
import { getPrismaClient, disconnectPrisma } from './db';
import { createLogger } from './utils/logger';
import { loadSecrets, buildConfigFromSecrets } from './utils/secrets';
import { initializeRedis, pingRedis, disconnectRedis } from './utils/redis';
import { initializeKafka, disconnectKafka } from './utils/kafka';
import { initializeStripe } from './utils/stripe';
import { correlationIdMiddleware } from './middleware/correlation-id';
import { metricsMiddleware } from './middleware/metrics';
import { register, recordKafkaConsumerLag } from './utils/metrics';
import { runWithCorrelationId } from './utils/correlation-id';
import { createAuthRoutes } from './routes/auth';
import { createPaymentRoutes } from './routes/payment';
import { createAssessmentRoutes } from './routes/assessment';
import { createTradingRoutes } from './routes/trading';
import { createFundedRoutes } from './routes/funded';
import { createAdminRoutes } from './routes/admin';
import { startPersistenceWorker, stopPersistenceWorker, getPersistenceWorkerHealth } from './workers/persistence-worker';
import { startRulesMonitoringWorker, stopRulesMonitoringWorker } from './workers/rules-monitoring-worker';
import { startRuleChecksPersistenceWorker, stopRuleChecksPersistenceWorker } from './workers/rule-checks-persistence-worker';
import { startFundedAccountActivationWorker, stopFundedAccountActivationWorker, processAssessmentCompletedEvent } from './workers/funded-account-activation-worker';
import { startFundedAccountPersistenceWorker, stopFundedAccountPersistenceWorker } from './workers/funded-account-persistence-worker';
import { startFundedAccountRulesWorker, stopFundedAccountRulesWorker } from './workers/funded-account-rules-worker';
import { startEventCancellationWorker, stopEventCancellationWorker, processEventCancellationEvent } from './workers/event-cancellation-worker';

const logger = createLogger('core-service');

let kafkaConsumer: Consumer | null = null;

async function initializeKafkaConsumer(brokers: string[], clientId: string, groupId: string): Promise<Consumer> {
  try {
    const kafka = new Kafka({
      clientId,
      brokers,
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
      },
    });

    kafkaConsumer = kafka.consumer({ groupId });

    kafkaConsumer.on('consumer.connect', () => {
      logger.info('Kafka consumer connected', { groupId });
    });

    kafkaConsumer.on('consumer.disconnect', () => {
      logger.info('Kafka consumer disconnected', { groupId });
    });

    kafkaConsumer.on('consumer.crash', ({ error, groupId: gid }) => {
      logger.error('Kafka consumer crashed', { error: String(error), groupId: gid });
    });

    return kafkaConsumer;
  } catch (error) {
    logger.error('Failed to initialize Kafka consumer', { error: String(error) });
    throw error;
  }
}

async function startKafkaConsumer(): Promise<void> {
  if (!kafkaConsumer) {
    throw new Error('Kafka consumer not initialized');
  }

  try {
    // Subscribe to assessment.completed and events.event-cancelled topics
    await kafkaConsumer.subscribe({ topics: ['assessment.completed', 'events.event-cancelled'], fromBeginning: false });
    logger.info('Kafka consumer subscribed to assessment.completed and events.event-cancelled');

    // Start consuming messages
    await kafkaConsumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        try {
          // Extract correlation ID from message headers
          const correlationIdHeader = payload.message.headers?.['correlation-id'];
          const correlationId = correlationIdHeader
            ? correlationIdHeader.toString()
            : 'unknown';

          // Extract trace context from message headers
          const carrier: Record<string, string> = {};
          if (payload.message.headers) {
            Object.entries(payload.message.headers).forEach(([key, value]) => {
              if (value instanceof Buffer) {
                carrier[key] = value.toString();
              } else if (typeof value === 'string') {
                carrier[key] = value;
              }
            });
          }

          // Route message based on topic
          if (payload.topic === 'assessment.completed') {
            // Run handler with correlation ID and trace context
            await runWithCorrelationId(correlationId, async () => {
              const extractedContext = propagation.extract(context.active(), carrier);
              await context.with(extractedContext, async () => {
                const message = JSON.parse(payload.message.value?.toString() || '{}');
                const { assessmentId, status } = message;

                logger.debug('Processing assessment.completed event', {
                  assessmentId,
                  status,
                });

                // Process the event through the funded account activation worker
                await processAssessmentCompletedEvent(assessmentId, status, correlationId);

                // Record consumer lag
                try {
                  const offsets = await kafkaConsumer.fetchOffsets(['assessment.completed']);
                  const topicOffsets = offsets.find(o => o.topic === 'assessment.completed');
                  if (topicOffsets) {
                    for (const partition of topicOffsets.partitions) {
                      const lag = parseInt(partition.high) - (parseInt(payload.message.offset) + 1);
                      recordKafkaConsumerLag('assessment.completed', partition.partition, 'core-service-group', Math.max(0, lag));
                    }
                  }
                } catch (error) {
                  logger.debug('Failed to record consumer lag', { error: String(error) });
                }
              });
            });
          } else if (payload.topic === 'events.event-cancelled') {
            // Run handler with correlation ID and trace context
            await runWithCorrelationId(correlationId, async () => {
              const extractedContext = propagation.extract(context.active(), carrier);
              await context.with(extractedContext, async () => {
                const message = JSON.parse(payload.message.value?.toString() || '{}');
                const { event_id, source, status } = message;

                logger.debug('Processing events.event-cancelled event', {
                  event_id,
                  source,
                  status,
                });

                // Process the event through the event cancellation worker
                await processEventCancellationEvent(event_id, source, status, correlationId, carrier);

                // Record consumer lag
                try {
                  const offsets = await kafkaConsumer.fetchOffsets(['events.event-cancelled']);
                  const topicOffsets = offsets.find(o => o.topic === 'events.event-cancelled');
                  if (topicOffsets) {
                    for (const partition of topicOffsets.partitions) {
                      const lag = parseInt(partition.high) - (parseInt(payload.message.offset) + 1);
                      recordKafkaConsumerLag('events.event-cancelled', partition.partition, 'core-service-group', Math.max(0, lag));
                    }
                  }
                } catch (error) {
                  logger.debug('Failed to record consumer lag', { error: String(error) });
                }
              });
            });
          }
        } catch (error) {
          logger.error('Failed to process message', {
            topic: payload.topic,
            partition: payload.partition,
            offset: payload.message.offset,
            error: String(error),
          });
        }
      },
    });

    logger.info('Kafka consumer started for assessment.completed and events.event-cancelled');
  } catch (error) {
    logger.error('Failed to start Kafka consumer', { error: String(error) });
    throw error;
  }
}

async function disconnectKafkaConsumer(): Promise<void> {
  if (kafkaConsumer) {
    try {
      await kafkaConsumer.disconnect();
      logger.info('Kafka consumer disconnected');
      kafkaConsumer = null;
    } catch (error) {
      logger.error('Failed to disconnect Kafka consumer', { error: String(error) });
    }
  }
}

async function startServer() {
  try {
    // Step 1: Load secrets from AWS Secrets Manager (with fallback to env vars)
    let secretsConfig: Record<string, any> = {};
    try {
      const secrets = await loadSecrets();
      secretsConfig = buildConfigFromSecrets(secrets);
      logger.info('Secrets loaded from AWS Secrets Manager');
    } catch (error) {
      logger.warn('Failed to load secrets from AWS Secrets Manager, falling back to environment variables', { error: String(error) });
    }

    // Step 2: Merge secrets into environment variables for config loading
    Object.entries(secretsConfig).forEach(([key, value]) => {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    });

    // Step 3: Load configuration (now with secrets merged into env)
    const config = loadConfig();
    logger.info('Configuration loaded', { port: config.port, nodeEnv: config.nodeEnv });

    // Step 4: Initialize Redis client
    initializeRedis(config.redisHost, config.redisPort, config.redisPassword);
    logger.info('Redis client initialized', { host: config.redisHost, port: config.redisPort });

    // Step 5: Initialize Kafka producer (best-effort, don't block startup)
    let kafkaInitialized = false;
    try {
      await initializeKafka(config.kafkaBrokers, config.kafkaClientId);
      logger.info('Kafka producer initialized', { brokers: config.kafkaBrokers });
      kafkaInitialized = true;
    } catch (error) {
      logger.warn('Failed to initialize Kafka producer, continuing without event publishing', { error: String(error) });
    }

    // Step 5.1: Initialize Kafka consumer for assessment.completed (best-effort)
    let kafkaConsumerInitialized = false;
    try {
      await initializeKafkaConsumer(config.kafkaBrokers, config.kafkaClientId, 'core-service-group');
      await startKafkaConsumer();
      logger.info('Kafka consumer initialized and started');
      kafkaConsumerInitialized = true;
    } catch (error) {
      logger.warn('Failed to initialize Kafka consumer, continuing without assessment.completed processing', { error: String(error) });
    }

    // Step 5.5: Start persistence worker
    await startPersistenceWorker();
    logger.info('Persistence worker started');

    // Step 5.6: Start rules monitoring worker
    await startRulesMonitoringWorker();
    logger.info('Rules monitoring worker started');

    // Step 5.7: Start rule checks persistence worker
    await startRuleChecksPersistenceWorker();
    logger.info('Rule checks persistence worker started');

    // Step 5.8: Start funded account activation worker
    await startFundedAccountActivationWorker();
    logger.info('Funded account activation worker started');

    // Step 5.9: Start funded account persistence worker
    await startFundedAccountPersistenceWorker();
    logger.info('Funded account persistence worker started');

    // Step 5.10: Start funded account rules worker
    await startFundedAccountRulesWorker();
    logger.info('Funded account rules worker started');

    // Step 5.11: Start event cancellation worker
    await startEventCancellationWorker();
    logger.info('Event cancellation worker started');

    // Step 6: Get Prisma client (lazy initialization with DATABASE_URL now set)
    const prisma = getPrismaClient();
    logger.info('Prisma client initialized');

    // Step 6.5: Initialize Stripe client
    initializeStripe(config.stripeSecretKey);
    logger.info('Stripe client initialized');

    // Step 7: Initialize Elysia app
    const app = new Elysia()
      .use(cors())
      .use(correlationIdMiddleware)
      .use(metricsMiddleware)
      .get('/health', () => ({ status: 'ok' }))
      .get('/health/persistence', () => {
        const health = getPersistenceWorkerHealth();
        return {
          status: health.healthy ? 'healthy' : 'unhealthy',
          lastSuccessTime: new Date(health.lastSuccessTime).toISOString(),
          consecutiveFailures: health.consecutiveFailures,
          timeSinceLastSuccess: health.timeSinceLastSuccess,
        };
      })
      .get('/ready', async () => {
        try {
          // Check database connectivity
          await prisma.$queryRaw`SELECT 1`;
          
          // Check Redis connectivity
          const redisHealthy = await pingRedis();
          if (!redisHealthy) {
            logger.error('Redis health check failed');
            return { status: 'not_ready', error: 'Redis unavailable' };
          }

          return { status: 'ready' };
        } catch (error) {
          logger.error('Readiness check failed', { error });
          return { status: 'not_ready', error: String(error) };
        }
      })
      .get('/metrics', async () => {
        return new Response(await register.metrics(), {
          headers: { 'Content-Type': register.contentType },
        });
      })
      .use(createAuthRoutes(config.jwtSecret, config.jwtExpiresIn))
      .use(createPaymentRoutes(config.stripeSecretKey, config.stripeWebhookSecret))
      .use(createAssessmentRoutes(config.jwtSecret))
      .use(createTradingRoutes({
        jwtSecret: config.jwtSecret,
        cryptoSlippage: config.cryptoSlippage,
        cryptoFee: config.cryptoFee,
        predictionSlippage: config.predictionSlippage,
        predictionFee: config.predictionFee,
      }))
      .use(createFundedRoutes({ jwtSecret: config.jwtSecret }))
      .use(createAdminRoutes({ jwtSecret: config.jwtSecret }))
      .listen(config.port);

    logger.info(`Core Service running on port ${app.server?.port}`);

    // Step 8: Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      await stopPersistenceWorker();
      await stopRulesMonitoringWorker();
      await stopRuleChecksPersistenceWorker();
      await stopFundedAccountActivationWorker();
      await stopFundedAccountPersistenceWorker();
      await stopFundedAccountRulesWorker();
      await stopEventCancellationWorker();
      if (kafkaConsumerInitialized) {
        await disconnectKafkaConsumer();
      }
      if (kafkaInitialized) {
        await disconnectKafka();
      }
      await disconnectRedis();
      await disconnectPrisma();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

startServer();
