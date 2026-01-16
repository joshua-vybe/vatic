import Redis from 'ioredis';
import { createLogger } from './logger';

const logger = createLogger('redis');

let redisClient: Redis | null = null;

export function initializeRedis(host: string, port: number, password?: string): Redis {
  try {
    redisClient = new Redis({
      host,
      port,
      password,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: null,
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected', { host, port });
    });

    redisClient.on('error', (error) => {
      logger.error('Redis error', { error: String(error) });
    });

    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis', { error: String(error) });
    throw error;
  }
}

export function getRedisClient(): Redis | null {
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('Redis disconnected');
      redisClient = null;
    } catch (error) {
      logger.error('Failed to disconnect Redis', { error: String(error) });
    }
  }
}
