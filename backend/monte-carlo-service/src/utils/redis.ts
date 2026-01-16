import { createClient, RedisClientType } from "redis";
import { Logger } from "./logger";

let redisClient: RedisClientType | null = null;

export async function initializeRedis(
  host: string,
  port: number,
  password?: string,
  logger?: Logger
): Promise<RedisClientType> {
  const clientOptions: any = {
    socket: {
      host,
      port,
    },
  };

  if (password) {
    clientOptions.password = password;
  }

  const client = createClient(clientOptions);

  await client.connect();
  logger?.info("Redis client connected", { host, port });

  redisClient = client;
  return client;
}

export function getRedisClient(): RedisClientType | null {
  return redisClient;
}

export async function pingRedis(logger?: Logger): Promise<boolean> {
  if (!redisClient) {
    logger?.error("Redis client not initialized");
    return false;
  }

  try {
    await redisClient.ping();
    return true;
  } catch (error) {
    logger?.error("Redis ping failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function disconnectRedis(logger?: Logger): Promise<void> {
  if (redisClient) {
    await redisClient.disconnect();
    redisClient = null;
    logger?.info("Redis client disconnected");
  }
}
