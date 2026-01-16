import { Kafka, Producer } from "kafkajs";
import { Logger } from "./logger";
import { getCorrelationId } from "./correlation-id";
import { context, propagation } from "@opentelemetry/api";

let kafkaProducer: Producer | null = null;

export async function initializeKafka(
  brokers: string[],
  clientId: string,
  logger: Logger
): Promise<Producer> {
  const kafka = new Kafka({
    clientId,
    brokers,
  });

  kafkaProducer = kafka.producer();
  await kafkaProducer.connect();
  logger.info("Kafka producer connected", { brokers });

  return kafkaProducer;
}

export async function publishEvent(
  topic: string,
  message: Record<string, any>,
  logger: Logger
): Promise<boolean> {
  if (!kafkaProducer) {
    logger.error("Kafka producer not initialized");
    return false;
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
    logger.info("Event published", { topic, latency });
    return true;
  } catch (error) {
    logger.error("Failed to publish event", {
      topic,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function disconnectKafka(logger: Logger): Promise<void> {
  if (kafkaProducer) {
    await kafkaProducer.disconnect();
    kafkaProducer = null;
    logger.info("Kafka producer disconnected");
  }
}
