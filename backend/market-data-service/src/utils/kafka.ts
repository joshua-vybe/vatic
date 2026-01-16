import { Kafka, Producer } from 'kafkajs';
import { createLogger } from './logger';
import { getCorrelationId } from './correlation-id';
import { context, propagation } from '@opentelemetry/api';

const logger = createLogger('kafka');

let kafkaProducer: Producer | null = null;

// Topic constants
export const TOPIC_BTC_TICKS = 'market-data.btc-ticks';
export const TOPIC_ETH_TICKS = 'market-data.eth-ticks';
export const TOPIC_SOL_TICKS = 'market-data.sol-ticks';
export const TOPIC_POLYMARKET_TICKS = 'market-data.polymarket-ticks';
export const TOPIC_KALSHI_TICKS = 'market-data.kalshi-ticks';
export const TOPIC_EVENT_CANCELLED = 'events.event-cancelled';
// Generic topic for other crypto pairs not explicitly mapped
export const TOPIC_CRYPTO_TICKS = 'market-data.crypto-ticks';

export async function initializeKafka(brokers: string[], clientId: string): Promise<Producer> {
  if (kafkaProducer) {
    return kafkaProducer;
  }

  try {
    const kafka = new Kafka({
      clientId,
      brokers,
    });

    kafkaProducer = kafka.producer();
    await kafkaProducer.connect();
    logger.info('Kafka producer connected', { brokers, clientId });
    return kafkaProducer;
  } catch (error) {
    logger.error('Failed to initialize Kafka producer', { error: String(error) });
    throw error;
  }
}

export async function publishEvent(
  topic: string,
  message: object
): Promise<{ success: boolean; latency: number }> {
  if (!kafkaProducer) {
    logger.warn('Kafka producer not initialized, skipping event publication', { topic });
    return { success: false, latency: 0 };
  }

  try {
    const startTime = Date.now();
    const correlationId = getCorrelationId();
    const headers: Record<string, string> = {
      'correlation-id': correlationId,
    };

    // Inject trace context into headers
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    Object.assign(headers, carrier);

    await kafkaProducer.send({
      topic,
      messages: [
        {
          value: JSON.stringify(message),
          headers,
        },
      ],
    });
    const latency = Date.now() - startTime;
    logger.debug('Event published', { topic, message, latency });
    return { success: true, latency };
  } catch (error) {
    logger.error('Failed to publish event', { topic, error: String(error) });
    return { success: false, latency: 0 };
  }
}

export async function disconnectKafka(): Promise<void> {
  if (kafkaProducer) {
    try {
      await kafkaProducer.disconnect();
      logger.info('Kafka producer disconnected');
      kafkaProducer = null;
    } catch (error) {
      logger.error('Failed to disconnect Kafka producer', { error: String(error) });
    }
  }
}

export function getKafkaProducer(): Producer | null {
  return kafkaProducer;
}
