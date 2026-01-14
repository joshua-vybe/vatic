import { PrismaClient } from '@prisma/client';

let prismaClient: PrismaClient | null = null;

/**
 * Get or create Prisma client instance.
 * Lazily initializes the client only when first requested,
 * ensuring DATABASE_URL is set (from secrets or env vars).
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL environment variable is not set. ' +
        'Ensure secrets are loaded before initializing Prisma client.'
      );
    }

    prismaClient = new PrismaClient({
      log: ['query', 'error', 'warn'],
    });
  }

  return prismaClient;
}

/**
 * Disconnect Prisma client.
 * Called during graceful shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await disconnectPrisma();
});

process.on('SIGINT', async () => {
  await disconnectPrisma();
});
