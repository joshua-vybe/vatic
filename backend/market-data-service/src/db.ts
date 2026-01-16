import { PrismaClient } from '@prisma/client';
import { createLogger } from './utils/logger';

const logger = createLogger('database');

let prismaClient: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient();
    logger.info('Prisma client initialized');
  }
  return prismaClient;
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    try {
      await prismaClient.$disconnect();
      logger.info('Prisma client disconnected');
      prismaClient = null;
    } catch (error) {
      logger.error('Failed to disconnect Prisma client', { error: String(error) });
    }
  }
}
