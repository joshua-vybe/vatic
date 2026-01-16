export interface MarketDataConfig {
  port: number;
  nodeEnv: string;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
  kafkaBrokers: string[];
  kafkaClientId: string;
  databaseUrl: string;
  coingeckoApiKey?: string;
  polymarketWsUrl: string;
  kalshiWsUrl: string;
  kalshiApiKey?: string;
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

export function loadConfig(overrides?: Partial<MarketDataConfig>): MarketDataConfig {
  return {
    port: parseInt(overrides?.port?.toString() || getEnv('PORT', '3001'), 10),
    nodeEnv: overrides?.nodeEnv || getEnv('NODE_ENV', 'development'),
    redisHost: overrides?.redisHost || getEnv('REDIS_HOST'),
    redisPort: overrides?.redisPort || parseInt(getEnv('REDIS_PORT', '6379'), 10),
    redisPassword: overrides?.redisPassword || process.env.REDIS_PASSWORD,
    kafkaBrokers: overrides?.kafkaBrokers || parseKafkaBrokers(getEnv('KAFKA_BROKERS')),
    kafkaClientId: overrides?.kafkaClientId || getEnv('KAFKA_CLIENT_ID', 'market-data-service'),
    databaseUrl: overrides?.databaseUrl || getEnv('DATABASE_URL'),
    coingeckoApiKey: overrides?.coingeckoApiKey || process.env.COINGECKO_API_KEY,
    polymarketWsUrl:
      overrides?.polymarketWsUrl ||
      getEnv('POLYMARKET_WS_URL', 'wss://ws-subscriptions-clob.polymarket.com/ws/market'),
    kalshiWsUrl: overrides?.kalshiWsUrl || getEnv('KALSHI_WS_URL', 'wss://api.elections.kalshi.com'),
    kalshiApiKey: overrides?.kalshiApiKey || process.env.KALSHI_API_KEY,
  };
}
