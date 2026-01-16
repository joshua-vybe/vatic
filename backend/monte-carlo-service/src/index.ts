import './utils/tracing';
import { Elysia } from "elysia";
import { loadConfig } from "./config";
import { getPrismaClient, disconnectPrisma } from "./db";
import { createLogger } from "./utils/logger";
import { initializeKafka, publishEvent, disconnectKafka } from "./utils/kafka";
import { initializeRedis, pingRedis, disconnectRedis } from "./utils/redis";
import { correlationIdMiddleware } from "./middleware/correlation-id";
import { metricsMiddleware } from "./middleware/metrics";
import { register } from "./utils/metrics";
import { healthCheckRayServe } from "./clients/ray-serve";
import {
  initializeConsumer,
  startConsumer,
  stopConsumer,
} from "./consumers/assessment-completed-consumer";
import {
  createSimulationJob,
  executeSimulationJob,
  getSimulationResult,
  listSimulationJobs,
} from "./services/job-manager";
import {
  startDailySimulationScheduler,
  stopScheduler,
} from "./services/cron-scheduler";

const logger = createLogger("monte-carlo-service");

async function startServer() {
  try {
    // Load configuration
    const config = loadConfig();
    logger.info("Configuration loaded", { port: config.port });

    // Initialize Redis
    await initializeRedis(
      config.redisHost,
      config.redisPort,
      config.redisPassword,
      logger
    );

    // Initialize Kafka producer
    const kafkaProducer = await initializeKafka(
      config.kafkaBrokers,
      config.kafkaClientId,
      logger
    );

    // Initialize Kafka consumer
    const kafkaConsumer = await initializeConsumer(
      config.kafkaBrokers,
      config.kafkaClientId,
      config.kafkaGroupId,
      logger
    );

    // Start Kafka consumer
    await startConsumer(
      kafkaConsumer,
      config.coreServiceUrl,
      config.rayServeUrl,
      logger
    );

    // Initialize Prisma
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    logger.info("Database connected");

    // Start cron scheduler
    await startDailySimulationScheduler(
      config.coreServiceUrl,
      config.rayServeUrl,
      logger
    );

    // Create Elysia app
    const app = new Elysia()
      .use(correlationIdMiddleware)
      .use(metricsMiddleware);

    // Health check endpoint
    app.get("/health", () => {
      return { status: "ok" };
    });

    // Readiness check endpoint
    app.get("/ready", async () => {
      try {
        const redisOk = await pingRedis(logger);
        const dbOk = await prisma.$queryRaw`SELECT 1`;
        const rayServeOk = await healthCheckRayServe(
          config.rayServeUrl,
          logger
        );

        if (!redisOk || !dbOk || !rayServeOk) {
          return {
            status: "not_ready",
            error: "One or more dependencies are unavailable",
          };
        }

        return { status: "ready" };
      } catch (error) {
        return {
          status: "not_ready",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    // Metrics endpoint
    app.get("/metrics", async () => {
      return new Response(await register.metrics(), {
        headers: { "Content-Type": register.contentType },
      });
    });

    // Manual simulation trigger endpoint
    app.post("/simulations", async (request) => {
      try {
        const body = request.body as any;
        const { assessmentId, fundedAccountId } = body;

        if (!assessmentId && !fundedAccountId) {
          return new Response(
            JSON.stringify({
              error: "Either assessmentId or fundedAccountId is required",
            }),
            { status: 400, headers: { "content-type": "application/json" } }
          );
        }

        const jobId = await createSimulationJob(
          assessmentId,
          fundedAccountId,
          config.coreServiceUrl,
          logger
        );

        // Execute asynchronously
        executeSimulationJob(jobId, config.rayServeUrl, logger).catch(
          (error) => {
            logger.error("Manual simulation execution failed", {
              jobId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        );

        return { jobId };
      } catch (error) {
        logger.error("Failed to trigger simulation", {
          error: error instanceof Error ? error.message : String(error),
        });
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
    });

    // Get simulation result endpoint
    app.get("/simulations/:id", async (request) => {
      try {
        const { id } = request.params as any;
        const result = await getSimulationResult(id, logger);
        
        if (!result) {
          return new Response(
            JSON.stringify({ error: "Simulation job not found" }),
            { status: 404, headers: { "content-type": "application/json" } }
          );
        }
        
        return result;
      } catch (error) {
        logger.error("Failed to get simulation result", {
          error: error instanceof Error ? error.message : String(error),
        });
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
    });

    // List simulations endpoint
    app.get("/simulations", async (request) => {
      try {
        const query = request.query as any;
        const { assessmentId, status } = query;
        const jobs = await listSimulationJobs(assessmentId, status, logger);
        return { jobs };
      } catch (error) {
        logger.error("Failed to list simulations", {
          error: error instanceof Error ? error.message : String(error),
        });
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
    });

    // Start server
    app.listen(config.port, () => {
      logger.info("Monte Carlo Service started", { port: config.port });
    });

    // Graceful shutdown handlers
    const shutdown = async () => {
      logger.info("Shutting down gracefully");
      await stopConsumer(logger);
      await disconnectKafka(logger);
      await disconnectRedis(logger);
      await disconnectPrisma();
      stopScheduler(logger);
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error) {
    logger.error("Failed to start server", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

startServer();
