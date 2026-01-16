export interface Config {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  kafkaBrokers: string[];
  kafkaClientId: string;
  kafkaGroupId: string;
  coreServiceUrl: string;
  monteCarloServiceUrl: string;
}

export function loadConfig(): Config {
  const kafkaBrokersStr = process.env.KAFKA_BROKERS || 'localhost:9092';
  const kafkaBrokers = kafkaBrokersStr.split(',').map(b => b.trim());

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  return {
    port: parseInt(process.env.PORT || '3004', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl,
    kafkaBrokers,
    kafkaClientId: process.env.KAFKA_CLIENT_ID || 'report-service',
    kafkaGroupId: process.env.KAFKA_GROUP_ID || 'report-service-group',
    coreServiceUrl: process.env.CORE_SERVICE_URL || 'http://core-service',
    monteCarloServiceUrl: process.env.MONTE_CARLO_SERVICE_URL || 'http://monte-carlo-service',
  };
}
