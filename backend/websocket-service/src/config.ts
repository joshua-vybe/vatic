export interface Config {
  port: number;
  nodeEnv: string;
  kafkaBrokers: string[];
  kafkaClientId: string;
  kafkaGroupId: string;
  jwtSecret: string;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  heartbeatInterval: number;
  connectionTimeout: number;
  nodeId: string;
}

export function loadConfig(): Config {
  const port = parseInt(process.env.PORT || '3003', 10);
  const nodeEnv = process.env.NODE_ENV || 'development';
  const kafkaBrokersStr = process.env.KAFKA_BROKERS || 'localhost:9092';
  const kafkaBrokers = kafkaBrokersStr.split(',').map((b) => b.trim());
  const kafkaClientId = process.env.KAFKA_CLIENT_ID || 'websocket-service';
  const kafkaGroupId = process.env.KAFKA_GROUP_ID || 'websocket-service-group';
  const jwtSecret = process.env.JWT_SECRET;
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  const redisPassword = process.env.REDIS_PASSWORD;
  const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10);
  const connectionTimeout = parseInt(process.env.CONNECTION_TIMEOUT || '60000', 10);
  const nodeId = process.env.POD_NAME || process.env.NODE_ID || `websocket-${Date.now()}`;

  // Validate required environment variables
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  return {
    port,
    nodeEnv,
    kafkaBrokers,
    kafkaClientId,
    kafkaGroupId,
    jwtSecret,
    redisHost,
    redisPort,
    redisPassword,
    heartbeatInterval,
    connectionTimeout,
    nodeId,
  };
}
