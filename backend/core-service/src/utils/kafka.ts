import { Kafka, Producer } from 'kafkajs';
import { createLogger } from './logger';

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

export async function publishEvent(topic: string, message: object): Promise<void> {
  if (!kafkaProducer) {
    logger.warn('Kafka producer not initialized, skipping event publication', { topic });
    return;
  }

  try {
    await kafkaProducer.send({
      topic,
      messages: [
        {
          value: JSON.stringify(message),
        },
      ],
    });
    logger.debug('Event published', { topic, message });
  } catch (error) {
    logger.error('Failed to publish event', { topic, error: String(error) });
    // Don't throw - allow authentication to proceed even if Kafka fails
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
