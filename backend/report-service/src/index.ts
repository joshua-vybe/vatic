import './utils/tracing';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { loadConfig } from './config';
import { getPrismaClient, disconnectPrisma } from './db';
import { createLogger } from './utils/logger';
import {
  initializeKafkaProducer,
  connectKafkaProducer,
  disconnectKafka,
} from './utils/kafka';
import { correlationIdMiddleware } from './middleware/correlation-id';
import { metricsMiddleware } from './middleware/metrics';
import { register } from './utils/metrics';
import * as assessmentCompletedConsumer from './consumers/assessment-completed-consumer';
import * as monteCarloCompletedConsumer from './consumers/monte-carlo-completed-consumer';

const logger = createLogger('report-service');

async function main() {
  try {
    // Load configuration
    const config = loadConfig();
    logger.info('Configuration loaded', {
      port: config.port,
      nodeEnv: config.nodeEnv,
    });

    // Initialize Prisma client and test connection
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection established');

    // Initialize Kafka producer
    initializeKafkaProducer(config.kafkaBrokers, config.kafkaClientId, logger);
    await connectKafkaProducer(logger);

    // Initialize Kafka consumers
    const assessmentConsumer = await assessmentCompletedConsumer.initializeConsumer(
      config.kafkaBrokers,
      `${config.kafkaClientId}-assessment`,
      config.kafkaGroupId,
      logger
    );

    const monteCarloConsumer = await monteCarloCompletedConsumer.initializeConsumer(
      config.kafkaBrokers,
      `${config.kafkaClientId}-monte-carlo`,
      config.kafkaGroupId,
      logger
    );

    // Start consumers
    await assessmentCompletedConsumer.startConsumer(
      assessmentConsumer,
      config.coreServiceUrl,
      logger
    );
    await monteCarloCompletedConsumer.startConsumer(
      monteCarloConsumer,
      config.monteCarloServiceUrl,
      logger
    );

    // Create Elysia app
    const app = new Elysia()
      .use(cors())
      .use(correlationIdMiddleware)
      .use(metricsMiddleware)
      .get('/health', () => ({ status: 'ok' }))
      .get('/ready', async () => {
        try {
          await prisma.$queryRaw`SELECT 1`;
          return { status: 'ready' };
        } catch (error) {
          return new Response(JSON.stringify({ status: 'not ready' }), { status: 503 });
        }
      })
      .get('/metrics', async () => {
        return new Response(await register.metrics(), {
          headers: { 'Content-Type': register.contentType },
        });
      })
      .get('/reports/:assessment_id', async ({ params }) => {
        try {
          const { assessment_id } = params;
          const report = await prisma.report.findUnique({
            where: { assessmentId: assessment_id },
          });

          if (!report) {
            return new Response(JSON.stringify({ error: 'Report not found' }), {
              status: 404,
            });
          }

          return {
            report: report.data,
            status: report.status,
          };
        } catch (error) {
          logger.error('Failed to fetch report', {
            error: error instanceof Error ? error.message : String(error),
          });
          return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
          });
        }
      })
      .listen(config.port);

    logger.info('Report Service started', { port: config.port });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);

      try {
        await assessmentCompletedConsumer.stopConsumer(logger);
        await monteCarloCompletedConsumer.stopConsumer(logger);
        await disconnectKafka(logger);
        await disconnectPrisma();
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start Report Service', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main();
