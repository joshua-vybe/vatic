import './utils/tracing';
import { Elysia } from 'elysia';
import { v4 as uuid } from 'uuid';
import { loadConfig } from './config';
import { createLogger } from './utils/logger';
import { verifyToken } from './utils/jwt';
import { initializeRedis, disconnectRedis, getRedisClient } from './utils/redis';
import { initializeKafkaConsumer, startKafkaConsumer, disconnectKafkaConsumer, getKafkaConsumer } from './utils/kafka';
import { correlationIdMiddleware } from './middleware/correlation-id';
import { metricsMiddleware } from './middleware/metrics';
import { register } from './utils/metrics';
import { ConnectionManager, ClientConnection } from './connection-manager';
import { startHeartbeatMonitor, stopHeartbeatMonitor } from './heartbeat';
import { MessageRouter } from './message-router';
import { MetricsCollector } from './utils/metrics';
import { ServiceDiscovery } from './scaling/service-discovery';

const logger = createLogger('websocket-service');

async function main() {
  try {
    // Load configuration
    const config = loadConfig();
    logger.info('Configuration loaded', {
      port: config.port,
      nodeEnv: config.nodeEnv,
      kafkaBrokers: config.kafkaBrokers,
      nodeId: config.nodeId,
    });

    // Initialize Redis
    const redis = initializeRedis(config.redisHost, config.redisPort, config.redisPassword);
    logger.info('Redis initialized');

    // Initialize Kafka consumer
    const kafkaConsumer = await initializeKafkaConsumer(
      config.kafkaBrokers,
      config.kafkaClientId,
      config.kafkaGroupId
    );
    logger.info('Kafka consumer initialized');

    // Track Kafka readiness
    let kafkaReady = false;
    kafkaConsumer.on('consumer.connect', () => {
      kafkaReady = true;
      logger.info('Kafka consumer connected');
    });
    kafkaConsumer.on('consumer.disconnect', () => {
      kafkaReady = false;
      logger.warn('Kafka consumer disconnected');
    });

    // Create connection manager and message router
    const connectionManager = new ConnectionManager();
    const metricsCollector = new MetricsCollector();
    const messageRouter = new MessageRouter(connectionManager, metricsCollector);

    // Initialize service discovery for horizontal scaling
    const serviceDiscovery = new ServiceDiscovery(config.nodeId, redis);
    await serviceDiscovery.initialize();
    logger.info('Service discovery initialized', { nodeId: config.nodeId });

    // Start Kafka consumer
    const kafkaMessageHandler = async (topic: string, message: any) => {
      try {
        // Extract assessmentId if present
        const assessmentId = message.assessmentId;

        // For assessment-specific messages, check if this node owns the assessment
        if (assessmentId && !topic.startsWith('market-data.')) {
          const ownerNode = serviceDiscovery.getNodeForAssessment(assessmentId);
          if (ownerNode !== config.nodeId) {
            logger.debug('Message for assessment owned by different node, skipping', {
              assessmentId,
              ownerNode,
              currentNode: config.nodeId,
            });
            return;
          }
        }

        await messageRouter.routeKafkaMessage(topic, message);
        metricsCollector.recordKafkaMessageProcessed();
      } catch (error) {
        logger.error('Failed to handle Kafka message', {
          topic,
          error: String(error),
        });
      }
    };

    await startKafkaConsumer(kafkaMessageHandler);
    logger.info('Kafka consumer started');

    // Start heartbeat monitor
    startHeartbeatMonitor(connectionManager, config.heartbeatInterval, config.connectionTimeout, metricsCollector);
    logger.info('Heartbeat monitor started');

    // Create Elysia app
    const app = new Elysia()
      .use(correlationIdMiddleware)
      .use(metricsMiddleware)
      // Health check endpoint
      .get('/health', () => ({
        status: 'ok',
        timestamp: new Date().toISOString(),
      }))

      // Readiness check endpoint
      .get('/ready', async () => {
        const redisClient = getRedisClient();
        const isRedisConnected = redisClient ? true : false;
        const isKafkaConnected = kafkaReady;

        return {
          status: isRedisConnected && isKafkaConnected ? 'ready' : 'not_ready',
          redis: isRedisConnected ? 'connected' : 'disconnected',
          kafka: isKafkaConnected ? 'connected' : 'disconnected',
          timestamp: new Date().toISOString(),
        };
      })

      // Metrics endpoint
      .get('/metrics', async () => {
        return new Response(await register.metrics(), {
          headers: { 'Content-Type': register.contentType },
        });
      })

      // WebSocket endpoint
      .ws('/ws', {
        open(ws: any) {
          try {
            const url = new URL(ws.url || '', 'http://localhost');
            const token = url.searchParams.get('token');
            const assessmentId = url.searchParams.get('assessmentId');

            // Verify JWT token
            if (!token) {
              logger.warn('WebSocket connection attempt without token');
              ws.send(JSON.stringify({ error: 'Unauthorized', message: 'Token required' }));
              ws.close(1008, 'Unauthorized');
              return;
            }

            const payload = verifyToken(token, config.jwtSecret);
            if (!payload) {
              logger.warn('WebSocket connection attempt with invalid token');
              ws.send(JSON.stringify({ error: 'Unauthorized', message: 'Invalid token' }));
              ws.close(1008, 'Unauthorized');
              return;
            }

            // Check if this node owns the assessment (for assessment-specific connections)
            if (assessmentId) {
              const ownerNode = serviceDiscovery.getNodeForAssessment(assessmentId);
              if (ownerNode !== config.nodeId) {
                logger.warn('Connection attempt for assessment owned by different node', {
                  assessmentId,
                  ownerNode,
                  currentNode: config.nodeId,
                });
                ws.send(
                  JSON.stringify({
                    error: 'Redirect',
                    message: 'This assessment is handled by a different node',
                    node: ownerNode,
                  })
                );
                ws.close(1008, 'Redirect to correct node');
                return;
              }
            }

            const userId = payload.userId;
            const connectionId = uuid();
            const now = new Date();

            const connection: ClientConnection = {
              ws,
              userId,
              assessmentId: assessmentId || undefined,
              connectedAt: now,
              lastHeartbeat: now,
            };

            // Add connection to manager
            connectionManager.addConnection(connectionId, connection);
            metricsCollector.recordConnectionOpened();
            if (assessmentId) {
              metricsCollector.recordConnectionByAssessment(assessmentId, 1);
            }

            // Send welcome message
            ws.send(
              JSON.stringify({
                type: 'connected',
                connectionId,
                userId,
                timestamp: new Date().toISOString(),
              })
            );

            logger.info('WebSocket connection established', {
              connectionId,
              userId,
              assessmentId,
              nodeId: config.nodeId,
            });
          } catch (error) {
            logger.error('WebSocket open error', { error: String(error) });
            ws.close(1011, 'Internal server error');
          }
        },

        message(ws: any, message: any) {
          try {
            const data = JSON.parse(message.toString());
            metricsCollector.recordMessageReceived();

            // Find connection by WebSocket instance
            const connections = connectionManager.getAllConnections();
            const connection = connections.find((c) => c.ws === ws);

            if (!connection) {
              logger.warn('Message from unknown connection');
              return;
            }

            // Handle pong response
            if (data.type === 'pong') {
              connection.lastHeartbeat = new Date();
              logger.debug('Pong received', { userId: connection.userId });
            }

            logger.debug('WebSocket message received', {
              userId: connection.userId,
              messageType: data.type,
            });
          } catch (error) {
            logger.error('WebSocket message error', { error: String(error) });
          }
        },

        close(ws: any) {
          try {
            // Find and remove connection
            const connections = connectionManager.getAllConnections();
            const connection = connections.find((c) => c.ws === ws);

            if (connection) {
              const durationSeconds = (Date.now() - connection.connectedAt.getTime()) / 1000;
              metricsCollector.recordConnectionClosed(durationSeconds);
              if (connection.assessmentId) {
                metricsCollector.recordConnectionByAssessment(connection.assessmentId, -1);
              }

              const connectionId = Array.from(connectionManager['connections'].entries()).find(
                ([_, conn]) => conn === connection
              )?.[0];

              if (connectionId) {
                connectionManager.removeConnection(connectionId);
              }

              logger.info('WebSocket connection closed', {
                userId: connection.userId,
                assessmentId: connection.assessmentId,
                durationSeconds,
              });
            }
          } catch (error) {
            logger.error('WebSocket close error', { error: String(error) });
          }
        },

        error(ws: any, error: any) {
          logger.error('WebSocket error', { error: String(error) });
        },
      });

    // Start server
    app.listen(config.port, () => {
      logger.info('WebSocket service started', {
        port: config.port,
        nodeEnv: config.nodeEnv,
        nodeId: config.nodeId,
      });
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down WebSocket service');

      try {
        stopHeartbeatMonitor();
        await serviceDiscovery.shutdown();
        await disconnectKafkaConsumer();
        await disconnectRedis();

        // Close all WebSocket connections
        const connections = connectionManager.getAllConnections();
        for (const connection of connections) {
          try {
            connection.ws.close(1001, 'Server shutting down');
          } catch (error) {
            logger.warn('Failed to close connection during shutdown', { error: String(error) });
          }
        }

        logger.info('WebSocket service shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error: String(error) });
        process.exit(1);
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('Failed to start WebSocket service', { error: String(error) });
    process.exit(1);
  }
}

main();
