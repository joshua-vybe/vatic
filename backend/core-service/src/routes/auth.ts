import { Elysia, t } from 'elysia';
import ms from 'ms';
import { getPrismaClient } from '../db';
import { getRedisClient } from '../utils/redis';
import { generateToken, verifyToken } from '../utils/jwt';
import { hashPassword, comparePassword } from '../utils/password';
import { publishEvent } from '../utils/kafka';
import { createLogger } from '../utils/logger';
import { createAuthMiddleware } from '../middleware/auth';

const logger = createLogger('auth-routes');

export function createAuthRoutes(jwtSecret: string, jwtExpiresIn: string) {
  const authMiddleware = createAuthMiddleware(jwtSecret);
  const prisma = getPrismaClient();
  const redis = getRedisClient();

  // Parse jwtExpiresIn to milliseconds
  const expiryMs = ms(jwtExpiresIn);
  if (!expiryMs || expiryMs <= 0) {
    throw new Error(`Invalid JWT_EXPIRES_IN format: ${jwtExpiresIn}`);
  }

  return new Elysia({ prefix: '/auth' })
    .post(
      '/register',
      async ({ body }: { body: { email: string; password: string } }) => {
        try {
          const { email, password } = body;

          // Check if email already exists
          const existingUser = await prisma.user.findUnique({
            where: { email },
          });

          if (existingUser) {
            logger.warn('Registration attempt with existing email', { email });
            return new Response(
              JSON.stringify({ error: 'Conflict', message: 'Email already registered' }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Hash password
          const passwordHash = await hashPassword(password);

          // Create user
          const user = await prisma.user.create({
            data: {
              email,
              passwordHash,
            },
          });

          // Generate JWT token
          const token = generateToken(user.id, jwtSecret, jwtExpiresIn);

          // Calculate expiration timestamp from configured jwtExpiresIn
          const expiresAt = new Date(Date.now() + expiryMs);

          // Create session in database
          const session = await prisma.session.create({
            data: {
              userId: user.id,
              token,
              expiresAt,
            },
          });

          // Cache session in Redis with 30-minute TTL
          if (redis) {
            await redis.setex(
              `session:${token}`,
              30 * 60,
              JSON.stringify({
                userId: user.id,
                expiresAt: expiresAt.toISOString(),
              })
            );
          }

          // Publish Kafka event asynchronously (non-blocking)
          publishEvent('auth.user-registered', {
            userId: user.id,
            email: user.email,
            timestamp: Date.now(),
          }).catch((error) => {
            logger.error('Failed to publish registration event', { error: String(error) });
          });

          logger.info('User registered successfully', { userId: user.id, email: user.email });

          return new Response(
            JSON.stringify({
              token,
              user: {
                id: user.id,
                email: user.email,
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          // Handle Prisma unique constraint error (race condition on email)
          if (error instanceof Error && 'code' in error && error.code === 'P2002') {
            logger.warn('Email uniqueness constraint violation during registration', { error: String(error) });
            return new Response(
              JSON.stringify({ error: 'Conflict', message: 'Email already registered' }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
          }
          logger.error('Registration failed', { error: String(error) });
          return new Response(
            JSON.stringify({ error: 'Internal Server Error', message: 'Registration failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      },
      {
        body: t.Object({
          email: t.String({ format: 'email' }),
          password: t.String({ minLength: 8 }),
        }),
      }
    )
    .post(
      '/login',
      async ({ body }: { body: { email: string; password: string } }) => {
        try {
          const { email, password } = body;

          // Find user by email
          const user = await prisma.user.findUnique({
            where: { email },
          });

          if (!user) {
            logger.warn('Login attempt with non-existent email', { email });
            return new Response(
              JSON.stringify({ error: 'Unauthorized', message: 'Invalid credentials' }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Compare password
          const passwordMatch = await comparePassword(password, user.passwordHash);

          if (!passwordMatch) {
            logger.warn('Login attempt with incorrect password', { userId: user.id });
            return new Response(
              JSON.stringify({ error: 'Unauthorized', message: 'Invalid credentials' }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Generate new JWT token
          const token = generateToken(user.id, jwtSecret, jwtExpiresIn);

          // Calculate expiration timestamp from configured jwtExpiresIn
          const expiresAt = new Date(Date.now() + expiryMs);

          // Create new session in database
          const session = await prisma.session.create({
            data: {
              userId: user.id,
              token,
              expiresAt,
            },
          });

          // Cache session in Redis with 30-minute TTL
          if (redis) {
            await redis.setex(
              `session:${token}`,
              30 * 60,
              JSON.stringify({
                userId: user.id,
                expiresAt: expiresAt.toISOString(),
              })
            );
          }

          // Publish Kafka event asynchronously (non-blocking)
          publishEvent('auth.user-logged-in', {
            userId: user.id,
            email: user.email,
            timestamp: Date.now(),
          }).catch((error) => {
            logger.error('Failed to publish login event', { error: String(error) });
          });

          logger.info('User logged in successfully', { userId: user.id, email: user.email });

          return new Response(
            JSON.stringify({
              token,
              user: {
                id: user.id,
                email: user.email,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          logger.error('Login failed', { error: String(error) });
          return new Response(
            JSON.stringify({ error: 'Internal Server Error', message: 'Login failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      },
      {
        body: t.Object({
          email: t.String({ format: 'email' }),
          password: t.String(),
        }),
      }
    )
    .use(authMiddleware)
    .get('/me', async ({ userId }: { userId: string }) => {
      try {
        // Fetch user from database
        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (!user) {
          logger.warn('User not found', { userId });
          return new Response(
            JSON.stringify({ error: 'Not Found', message: 'User not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        logger.debug('User profile retrieved', { userId });

        return new Response(
          JSON.stringify({
            user: {
              id: user.id,
              email: user.email,
              createdAt: user.createdAt,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        logger.error('Failed to retrieve user profile', { userId, error: String(error) });
        return new Response(
          JSON.stringify({ error: 'Internal Server Error', message: 'Failed to retrieve profile' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    });
}
