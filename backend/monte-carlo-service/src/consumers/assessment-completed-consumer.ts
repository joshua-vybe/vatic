import { Kafka, Consumer, EachMessagePayload } from "kafkajs";
import { context, propagation } from "@opentelemetry/api";
import { Logger } from "../utils/logger";
import { runWithCorrelationId } from "../utils/correlation-id";
import { recordKafkaConsumerLag } from "../utils/metrics";
import {
  createSimulationJob,
  executeSimulationJob,
} from "../services/job-manager";

let kafkaConsumer: Consumer | null = null;

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

  kafkaConsumer = kafka.consumer({ groupId });
  await kafkaConsumer.connect();
  logger.info("Kafka consumer connected", { brokers, groupId });

  return kafkaConsumer;
}

export async function startConsumer(
  consumer: Consumer,
  coreServiceUrl: string,
  rayServeUrl: string,
  logger: Logger
): Promise<void> {
  await consumer.subscribe({ topic: "assessment.completed" });

  await consumer.run({
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
            const message = JSON.parse(payload.message.value?.toString() || "{}");
            const { assessmentId, status } = message;

            logger.info("Received assessment.completed event", {
              assessmentId,
              status,
            });

            // Only process passed assessments
            if (status !== "passed") {
              logger.info("Skipping non-passed assessment", {
                assessmentId,
                status,
              });
              return;
            }

            logger.info("Triggering Monte Carlo simulation for assessment", {
              assessmentId,
            });

            // Create simulation job
            const jobId = await createSimulationJob(
              assessmentId,
              undefined,
              coreServiceUrl,
              logger
            );

            // Execute simulation asynchronously (don't await)
            executeSimulationJob(jobId, rayServeUrl, logger).catch((error) => {
              logger.error("Async simulation execution failed", {
                jobId,
                error: error instanceof Error ? error.message : String(error),
              });
            });

            // Record consumer lag
            try {
              const offsets = await consumer.fetchOffsets(["assessment.completed"]);
              const topicOffsets = offsets.find(o => o.topic === "assessment.completed");
              if (topicOffsets) {
                for (const partition of topicOffsets.partitions) {
                  const lag = parseInt(partition.high) - (parseInt(payload.message.offset) + 1);
                  recordKafkaConsumerLag("assessment.completed", partition.partition, "monte-carlo-service-group", Math.max(0, lag));
                }
              }
            } catch (error) {
              logger.debug("Failed to record consumer lag", { error: String(error) });
            }
          });
        });
      } catch (error) {
        logger.error("Failed to process assessment.completed event", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  logger.info("Assessment completed consumer started");
}

export async function stopConsumer(logger: Logger): Promise<void> {
  if (kafkaConsumer) {
    await kafkaConsumer.disconnect();
    kafkaConsumer = null;
    logger.info("Kafka consumer disconnected");
  }
}
