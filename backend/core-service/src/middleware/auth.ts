import { Elysia, Context } from 'elysia';
import { getPrismaClient } from '../db';
import { getRedisClient } from '../utils/redis';
import { verifyToken } from '../utils/jwt';
import { createLogger } from '../utils/logger';

const logger = createLogger('auth-middleware');

export interface AuthContext {
  userId: string;
}

export function createAuthMiddleware(jwtSecret: string) {
  return new Elysia({ name: 'auth' }).derive(async (context: Context) => {
    const authHeader = context.request.headers.get('authorization');

    const unauthorizedResponse = new Response(
      JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing authentication' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );

    if (!authHeader) {
      logger.debug('Missing authorization header');
      context.set.status = 401;
      context.set.return = unauthorizedResponse;
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      logger.debug('Invalid authorization header format');
      context.set.status = 401;
      context.set.return = unauthorizedResponse;
      return;
    }

    const token = parts[1];
    const redis = getRedisClient();
    const prisma = getPrismaClient();

    try {
      // Check Redis cache first
      if (redis) {
        const cachedSession = await redis.get(`session:${token}`);
        if (cachedSession) {
          const sessionData = JSON.parse(cachedSession);
          const expiresAt = new Date(sessionData.expiresAt);
          if (expiresAt > new Date()) {
            logger.debug('Session found in cache', { userId: sessionData.userId });
            return { userId: sessionData.userId };
          }
        }
      }

      // Verify token
      const payload = verifyToken(token, jwtSecret);
      if (!payload) {
        logger.debug('Invalid or expired token');
        context.set.status = 401;
        context.set.return = unauthorizedResponse;
        return;
      }

      // Query database for session
      const session = await prisma.session.findUnique({
        where: { token },
      });

      if (!session) {
        logger.debug('Session not found in database', { userId: payload.userId });
        context.set.status = 401;
        context.set.return = unauthorizedResponse;
        return;
      }

      if (session.expiresAt < new Date()) {
        logger.debug('Session expired', { userId: payload.userId });
        context.set.status = 401;
        context.set.return = unauthorizedResponse;
        return;
      }

      // Refresh Redis cache with 30-minute TTL
      if (redis) {
        await redis.setex(
          `session:${token}`,
          30 * 60,
          JSON.stringify({
            userId: session.userId,
            expiresAt: session.expiresAt.toISOString(),
          })
        );
      }

      logger.debug('Session verified', { userId: session.userId });
      return { userId: session.userId };
    } catch (error) {
      logger.error('Authentication failed', { error: String(error) });
      context.set.status = 401;
      context.set.return = unauthorizedResponse;
      return;
    }
  });
}
