import Redis from 'ioredis';

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
    console.error('Redis connection error:', error);
  });

  redisClient.on('connect', () => {
    console.log('Redis connected');
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
    console.error('Redis ping failed:', error);
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
