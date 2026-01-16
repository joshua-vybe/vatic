import Redis from 'ioredis';
import { createLogger } from './logger';

const logger = createLogger('redis');

let redisClient: Redis | null = null;

export function initializeRedis(host: string, port: number, password?: string): Redis {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis({
    host,
    port,
    password: password || undefined,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: null,
  });

  redisClient.on('error', (error) => {
    logger.error('Redis connection error', { error: String(error) });
  });

  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });

  return redisClient;
}

export function getRedisClient(): Redis | null {
  return redisClient;
}

export async function pingRedis(): Promise<boolean> {
  try {
    if (!redisClient) {
      return false;
    }
    const result = await redisClient.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis ping failed', { error: String(error) });
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export async function cacheMarketPrice(
  market: string,
  price: number | { yes: number; no: number },
  ttl: number
): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      logger.warn('Redis client not available for caching', { market });
      return;
    }

    const key = `market:${market}:price`;
    const value = typeof price === 'number' ? price.toString() : JSON.stringify(price);
    await redis.setex(key, ttl, value);
    logger.debug('Market price cached', { market, ttl });
  } catch (error) {
    logger.error('Failed to cache market price', { market, error: String(error) });
  }
}
