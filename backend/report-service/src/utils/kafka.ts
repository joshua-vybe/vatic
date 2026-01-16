import { Kafka, Producer } from 'kafkajs';
import { Logger } from './logger';
import { getCorrelationId } from './correlation-id';
import { context, propagation } from '@opentelemetry/api';

let producer: Producer | null = null;

export function initializeKafkaProducer(brokers: string[], clientId: string, logger: Logger): Producer {
  const kafka = new Kafka({
    clientId,
    brokers,
  });

  producer = kafka.producer();
  logger.info('Kafka producer initialized', { brokers, clientId });
  return producer;
}

export async function connectKafkaProducer(logger: Logger): Promise<void> {
  if (!producer) {
    throw new Error('Kafka producer not initialized');
  }
  await producer.connect();
  logger.info('Kafka producer connected');
}

export async function publishEvent(
  topic: string,
  messages: Array<{ key: string; value: string }>,
  logger: Logger
): Promise<void> {
  if (!producer) {
    throw new Error('Kafka producer not initialized');
  }
  const correlationId = getCorrelationId();
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  const messagesWithHeaders = messages.map(msg => ({
    ...msg,
    headers: {
      'correlation-id': correlationId,
      ...carrier,
    },
  }));
  await producer.send({ topic, messages: messagesWithHeaders });
  logger.debug(`Published ${messages.length} messages to topic: ${topic}`);
}

export async function disconnectKafka(logger: Logger): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
    logger.info('Kafka producer disconnected');
  }
}

export function getKafkaProducer(): Producer {
  if (!producer) {
    throw new Error('Kafka producer not initialized');
  }
  return producer;
}
