import { Kafka, Producer } from 'kafkajs';
import { createLogger } from './logger';
import { getCorrelationId } from './correlation-id';
import { context, trace, propagation } from '@opentelemetry/api';

const logger = createLogger('kafka');

let kafkaProducer: Producer | null = null;

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

export async function publishEvent(topic: string, message: object): Promise<{ success: boolean; latency: number }> {
  if (!kafkaProducer) {
    logger.warn('Kafka producer not initialized, skipping event publication', { topic });
    return { success: false, latency: 0 };
  }

  const startTime = Date.now();
  try {
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
    return { success: false, latency: Date.now() - startTime };
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
