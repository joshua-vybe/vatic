import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

export interface SecretsBundle {
  database?: Record<string, any>;
  redis?: Record<string, any>;
  kafka?: Record<string, any>;
  stripe?: Record<string, any>;
}

export async function getSecret(secretName: string): Promise<Record<string, any>> {
  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await client.send(command);
    return JSON.parse(response.SecretString || '{}');
  } catch (error) {
    console.error(`Failed to retrieve secret: ${secretName}`, error);
    throw error;
  }
}

export async function loadSecrets(): Promise<SecretsBundle> {
  try {
    const [database, redis, kafka, stripe] = await Promise.all([
      getSecret('vatic-prop/database').catch(() => ({})),
      getSecret('vatic-prop/redis').catch(() => ({})),
      getSecret('vatic-prop/kafka').catch(() => ({})),
      getSecret('vatic-prop/stripe').catch(() => ({})),
    ]);
    return { database, redis, kafka, stripe };
  } catch (error) {
    console.error('Failed to load secrets', error);
    throw error;
  }
}

export function buildConfigFromSecrets(secrets: SecretsBundle): Partial<Record<string, any>> {
  const config: Record<string, any> = {};

  if (secrets.database?.host) {
    config.DATABASE_URL = `postgresql://${secrets.database.username}:${secrets.database.password}@${secrets.database.host}:${secrets.database.port}/${secrets.database.database}?sslmode=${secrets.database.sslmode || 'require'}`;
  }

  if (secrets.redis?.host) {
    config.REDIS_HOST = secrets.redis.host;
    config.REDIS_PORT = secrets.redis.port || 6379;
    config.REDIS_PASSWORD = secrets.redis.password;
  }

  if (secrets.kafka?.brokers) {
    config.KAFKA_BROKERS = Array.isArray(secrets.kafka.brokers)
      ? secrets.kafka.brokers.join(',')
      : secrets.kafka.brokers;
    config.KAFKA_CLIENT_ID = secrets.kafka.clientId || 'vatic-prop';
  }

  if (secrets.stripe?.secretKey) {
    config.STRIPE_SECRET_KEY = secrets.stripe.secretKey;
    config.STRIPE_WEBHOOK_SECRET = secrets.stripe.webhookSecret;
  }

  return config;
}
