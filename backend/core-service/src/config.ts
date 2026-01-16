export interface Config {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  kafkaBrokers: string[];
  kafkaClientId: string;
  awsRegion: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  cryptoSlippage: number;
  cryptoFee: number;
  predictionSlippage: number;
  predictionFee: number;
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue || '';
}

function parseKafkaBrokers(brokerString: string): string[] {
  if (!brokerString || brokerString.trim() === '') {
    throw new Error('KAFKA_BROKERS must be a non-empty comma-separated list of broker addresses');
  }
  
  const brokers = brokerString
    .split(',')
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0);
  
  if (brokers.length === 0) {
    throw new Error('KAFKA_BROKERS must contain at least one valid broker address');
  }
  
  return brokers;
}

export function loadConfig(overrides?: Partial<Config>): Config {
  return {
    port: parseInt(overrides?.port?.toString() || getEnv('PORT', '3000'), 10),
    nodeEnv: overrides?.nodeEnv || getEnv('NODE_ENV', 'development'),
    databaseUrl: overrides?.databaseUrl || getEnv('DATABASE_URL'),
    redisHost: overrides?.redisHost || getEnv('REDIS_HOST'),
    redisPort: overrides?.redisPort || parseInt(getEnv('REDIS_PORT', '6379'), 10),
    redisPassword: overrides?.redisPassword || process.env.REDIS_PASSWORD,
    kafkaBrokers: overrides?.kafkaBrokers || parseKafkaBrokers(getEnv('KAFKA_BROKERS')),
    kafkaClientId: overrides?.kafkaClientId || getEnv('KAFKA_CLIENT_ID', 'vatic-prop'),
    awsRegion: overrides?.awsRegion || getEnv('AWS_REGION', 'us-east-1'),
    stripeSecretKey: overrides?.stripeSecretKey || getEnv('STRIPE_SECRET_KEY'),
    stripeWebhookSecret: overrides?.stripeWebhookSecret || getEnv('STRIPE_WEBHOOK_SECRET'),
    jwtSecret: overrides?.jwtSecret || getEnv('JWT_SECRET'),
    jwtExpiresIn: overrides?.jwtExpiresIn || getEnv('JWT_EXPIRES_IN', '30d'),
    cryptoSlippage: parseFloat(getEnv('CRYPTO_SLIPPAGE_PERCENT', '0.001')),
    cryptoFee: parseFloat(getEnv('CRYPTO_FEE_PERCENT', '0.001')),
    predictionSlippage: parseFloat(getEnv('PREDICTION_SLIPPAGE_PERCENT', '0.002')),
    predictionFee: parseFloat(getEnv('PREDICTION_FEE_PERCENT', '0.002')),
  };
}
