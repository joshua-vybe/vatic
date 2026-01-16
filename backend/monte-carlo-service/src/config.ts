export interface Config {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  kafkaBrokers: string[];
  kafkaClientId: string;
  kafkaGroupId: string;
  rayServeUrl: string;
  coreServiceUrl: string;
  awsRegion: string;
}

export function parseKafkaBrokers(brokerString: string): string[] {
  return brokerString.split(",").map((broker) => broker.trim());
}

export function loadConfig(): Config {
  const nodeEnv = process.env.NODE_ENV || "development";
  const databaseUrl = process.env.DATABASE_URL;
  const kafkaBrokers = process.env.KAFKA_BROKERS || "localhost:9092";
  const rayServeUrl = process.env.RAY_SERVE_URL || "http://ray-head-svc:8000";
  const coreServiceUrl =
    process.env.CORE_SERVICE_URL || "http://core-service";

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  return {
    port: parseInt(process.env.PORT || "3002", 10),
    nodeEnv,
    databaseUrl,
    redisHost: process.env.REDIS_HOST || "localhost",
    redisPort: parseInt(process.env.REDIS_PORT || "6379", 10),
    redisPassword: process.env.REDIS_PASSWORD,
    kafkaBrokers: parseKafkaBrokers(kafkaBrokers),
    kafkaClientId: process.env.KAFKA_CLIENT_ID || "monte-carlo-service",
    kafkaGroupId:
      process.env.KAFKA_GROUP_ID || "monte-carlo-service-group",
    rayServeUrl,
    coreServiceUrl,
    awsRegion: process.env.AWS_REGION || "us-east-1",
  };
}
