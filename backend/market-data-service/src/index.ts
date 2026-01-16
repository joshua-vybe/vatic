import './utils/tracing';
import { Elysia } from 'elysia';
import { loadConfig } from './config';
import { createLogger } from './utils/logger';
import { initializeKafka, disconnectKafka, getKafkaProducer } from './utils/kafka';
import { initializeRedis, pingRedis, disconnectRedis } from './utils/redis';
import { getPrismaClient, disconnectPrisma } from './db';
import { correlationIdMiddleware } from './middleware/correlation-id';
import { metricsMiddleware } from './middleware/metrics';
import { register } from './utils/metrics';
import { CoingeckoIngestor } from './ingestors/coingecko';
import { PolymarketIngestor } from './ingestors/polymarket';
import { KalshiIngestor } from './ingestors/kalshi';
import { getMetrics, setIngestorRunning, setCircuitBreakerState } from './utils/metrics';

const logger = createLogger('market-data-service');

async function startServer() {
  try {
    // Load configuration
    const config = loadConfig();
    logger.info('Configuration loaded', { port: config.port, nodeEnv: config.nodeEnv });

    // Initialize Redis
    initializeRedis(config.redisHost, config.redisPort, config.redisPassword);
    logger.info('Redis client initialized', { host: config.redisHost, port: config.redisPort });

    // Initialize Kafka
    await initializeKafka(config.kafkaBrokers, config.kafkaClientId);
    logger.info('Kafka producer initialized', { brokers: config.kafkaBrokers });

    // Initialize Prisma (lazy initialization)
    const prisma = getPrismaClient();
    logger.info('Prisma client initialized');

    // Create ingestor instances
    const coingeckoIngestor = new CoingeckoIngestor(config.coingeckoApiKey);
    const polymarketIngestor = new PolymarketIngestor(config.polymarketWsUrl);
    const kalshiIngestor = new KalshiIngestor(config.kalshiWsUrl, config.kalshiApiKey);

    // Start all ingestors
    await Promise.all([
      coingeckoIngestor.start(),
      polymarketIngestor.start(),
      kalshiIngestor.start(),
    ]);
    logger.info('All ingestors started');

    // Periodically update circuit breaker state metrics
    setInterval(() => {
      setCircuitBreakerState('coingecko', coingeckoIngestor.getCircuitBreakerState());
      setCircuitBreakerState('polymarket', polymarketIngestor.getCircuitBreakerState());
      setCircuitBreakerState('kalshi', kalshiIngestor.getCircuitBreakerState());
    }, 5000);

    // Initialize Elysia app
    const app = new Elysia()
      .use(correlationIdMiddleware)
      .use(metricsMiddleware)
      .get('/health', () => ({ status: 'ok' }))
      .get('/ready', async () => {
        try {
          // Check Redis connectivity
          const redisHealthy = await pingRedis();
          if (!redisHealthy) {
            logger.error('Redis health check failed');
            return { status: 'not_ready', error: 'Redis unavailable' };
          }

          // Check database connectivity
          await prisma.$queryRaw`SELECT 1`;

          // Check Kafka producer health
          const kafkaProducer = getKafkaProducer();
          if (!kafkaProducer) {
            logger.error('Kafka producer not initialized');
            return { status: 'not_ready', error: 'Kafka producer unavailable' };
          }

          // Check ingestor running state
          const coingeckoRunning = coingeckoIngestor.getState() === 'running';
          const polymarketRunning = polymarketIngestor.getState() === 'running';
          const kalshiRunning = kalshiIngestor.getState() === 'running';

          if (!coingeckoRunning && !polymarketRunning && !kalshiRunning) {
            logger.error('All ingestors are stopped');
            return { status: 'not_ready', error: 'All ingestors are stopped' };
          }

          return {
            status: 'ready',
            ingestors: {
              coingecko: coingeckoRunning ? 'running' : 'stopped',
              polymarket: polymarketRunning ? 'running' : 'stopped',
              kalshi: kalshiRunning ? 'running' : 'stopped',
            },
          };
        } catch (error) {
          logger.error('Readiness check failed', { error: String(error) });
          return { status: 'not_ready', error: String(error) };
        }
      })
      .get('/metrics', async () => {
        return new Response(await register.metrics(), {
          headers: { 'Content-Type': register.contentType },
        });
      })
      .listen(config.port);

    logger.info(`Market Data Service running on port ${app.server?.port}`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);

      // Stop all ingestors (they will update metrics)
      await Promise.all([
        coingeckoIngestor.stop(),
        polymarketIngestor.stop(),
        kalshiIngestor.stop(),
      ]);

      // Disconnect services
      await disconnectKafka();
      await disconnectRedis();
      await disconnectPrisma();

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server', { error: String(error) });
    process.exit(1);
  }
}

startServer();

