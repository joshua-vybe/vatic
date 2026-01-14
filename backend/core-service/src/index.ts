import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { loadConfig } from './config';
import { getPrismaClient, disconnectPrisma } from './db';
import { createLogger } from './utils/logger';
import { loadSecrets, buildConfigFromSecrets } from './utils/secrets';
import { initializeRedis, pingRedis, disconnectRedis } from './utils/redis';
import { initializeKafka, disconnectKafka } from './utils/kafka';
import { initializeStripe } from './utils/stripe';
import { createAuthRoutes } from './routes/auth';
import { createPaymentRoutes } from './routes/payment';
import { createAssessmentRoutes } from './routes/assessment';
import { startPersistenceWorker, stopPersistenceWorker } from './workers/persistence-worker';

const logger = createLogger('core-service');

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

    // Step 5.5: Start persistence worker
    await startPersistenceWorker();
    logger.info('Persistence worker started');

    // Step 6: Get Prisma client (lazy initialization with DATABASE_URL now set)
    const prisma = getPrismaClient();
    logger.info('Prisma client initialized');

    // Step 6.5: Initialize Stripe client
    initializeStripe(config.stripeSecretKey);
    logger.info('Stripe client initialized');

    // Step 7: Initialize Elysia app
    const app = new Elysia()
      .use(cors())
      .get('/health', () => ({ status: 'ok' }))
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
      .use(createAuthRoutes(config.jwtSecret, config.jwtExpiresIn))
      .use(createPaymentRoutes(config.stripeSecretKey, config.stripeWebhookSecret))
      .use(createAssessmentRoutes(config.jwtSecret))
      .listen(config.port);

    logger.info(`Core Service running on port ${app.server?.port}`);

    // Step 8: Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      await stopPersistenceWorker();
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
