import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { context, propagation } from '@opentelemetry/api';
import { createLogger } from './logger';
import { setCorrelationId, runWithCorrelationId } from './correlation-id';
import { recordKafkaConsumerLag } from './metrics';

const logger = createLogger('kafka');

let kafkaConsumer: Consumer | null = null;

export async function initializeKafkaConsumer(
  brokers: string[],
  clientId: string,
  groupId: string
): Promise<Consumer> {
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

export async function startKafkaConsumer(
  messageHandler: (topic: string, message: any) => Promise<void>
): Promise<void> {
  if (!kafkaConsumer) {
    throw new Error('Kafka consumer not initialized');
  }

  try {
    // Subscribe to all required topics
    const topics = [
      'market-data.btc-ticks',
      'market-data.eth-ticks',
      'market-data.sol-ticks',
      'market-data.polymarket-ticks',
      'market-data.kalshi-ticks',
      'trading.order-filled',
      'trading.position-opened',
      'trading.position-closed',
      'assessment.balance-updated',
      'assessment.pnl-updated',
      'assessment.created',
      'assessment.started',
      'assessment.completed',
      'rules.violation-detected',
      'rules.drawdown-checked',
    ];

    await kafkaConsumer.subscribe({ topics, fromBeginning: false });
    logger.info('Kafka consumer subscribed to topics', { topics: topics.length });

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

          // Run handler with correlation ID and trace context
          await runWithCorrelationId(correlationId, async () => {
            const extractedContext = propagation.extract(context.active(), carrier);
            await context.with(extractedContext, async () => {
              const message = JSON.parse(payload.message.value?.toString() || '{}');
              await messageHandler(payload.topic, message);

              // Record consumer lag
              try {
                const offsets = await kafkaConsumer.fetchOffsets([payload.topic]);
                const topicOffsets = offsets.find(o => o.topic === payload.topic);
                if (topicOffsets) {
                  for (const partition of topicOffsets.partitions) {
                    const lag = parseInt(partition.high) - (parseInt(payload.message.offset) + 1);
                    recordKafkaConsumerLag(payload.topic, partition.partition, 'websocket-service-group', Math.max(0, lag));
                  }
                }
              } catch (error) {
                logger.debug('Failed to record consumer lag', { error: String(error) });
              }
            });
          });
        } catch (error) {
          logger.error('Failed to process Kafka message', {
            topic: payload.topic,
            partition: payload.partition,
            offset: payload.message.offset,
            error: String(error),
          });
        }
      },
    });

    logger.info('Kafka consumer started');
  } catch (error) {
    logger.error('Failed to start Kafka consumer', { error: String(error) });
    throw error;
  }
}

export async function disconnectKafkaConsumer(): Promise<void> {
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

export function getKafkaConsumer(): Consumer | null {
  return kafkaConsumer;
}
