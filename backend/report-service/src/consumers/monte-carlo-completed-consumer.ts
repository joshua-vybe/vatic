import { Consumer, Kafka } from 'kafkajs';
import { context, propagation } from '@opentelemetry/api';
import { Logger } from '../utils/logger';
import { runWithCorrelationId } from '../utils/correlation-id';
import { enrichReportWithMonteCarlo } from '../services/report-generator';

let consumer: Consumer | null = null;

export async function initializeConsumer(
  brokers: string[],
  clientId: string,
  groupId: string,
  logger: Logger
): Promise<Consumer> {
  const kafka = new Kafka({
    clientId,
    brokers,
  });

  consumer = kafka.consumer({ groupId });
  logger.info('Monte Carlo completed consumer initialized', { brokers, clientId, groupId });
  return consumer;
}

export async function startConsumer(
  consumerInstance: Consumer,
  monteCarloServiceUrl: string,
  logger: Logger
): Promise<void> {
  try {
    await consumerInstance.connect();
    await consumerInstance.subscribe({ topic: 'montecarlo.simulation-completed' });

    await consumerInstance.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          if (!message.value) {
            logger.warn('Received empty message', { topic, partition });
            return;
          }

          // Extract correlation ID from message headers
          const correlationIdHeader = message.headers?.['correlation-id'];
          const correlationId = correlationIdHeader
            ? correlationIdHeader.toString()
            : 'unknown';

          // Extract trace context from message headers
          const carrier: Record<string, string> = {};
          if (message.headers) {
            Object.entries(message.headers).forEach(([key, value]) => {
              if (value instanceof Buffer) {
                carrier[key] = value.toString();
              } else if (typeof value === 'string') {
                carrier[key] = value;
              }
            });
          }

          // Run handler with correlation ID and trace context
          await runWithCorrelationId(correlationId, async () => {
            const extractedContext = propagation.extract(context.active(), carrier);
            await context.with(extractedContext, async () => {
              const payload = JSON.parse(message.value.toString());
              const { jobId, assessmentId, result } = payload;

              logger.info('Processing montecarlo.simulation-completed event', {
                assessmentId,
              });

              await enrichReportWithMonteCarlo(assessmentId, monteCarloServiceUrl, logger);

              logger.info('Monte Carlo completed event processed successfully', {
                assessmentId,
              });
            });
          });
        } catch (error) {
          logger.error('Failed to process montecarlo.simulation-completed event', {
            error: error instanceof Error ? error.message : String(error),
            partition,
          });
        }
      },
    });

    logger.info('Monte Carlo completed consumer started');
  } catch (error) {
    logger.error('Failed to start Monte Carlo completed consumer', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function stopConsumer(logger: Logger): Promise<void> {
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
    logger.info('Monte Carlo completed consumer stopped');
  }
}
