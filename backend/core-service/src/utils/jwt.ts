import jwt from 'jsonwebtoken';
import { createLogger } from './logger';

const logger = createLogger('jwt');

export interface TokenPayload {
  userId: string;
  iat: number;
  exp: number;
}

export function generateToken(userId: string, secret: string, expiresIn: string): string {
  try {
    const token = jwt.sign({ userId }, secret, { expiresIn });
    logger.debug('Token generated', { userId });
    return token;
  } catch (error) {
    logger.error('Failed to generate token', { userId, error: String(error) });
    throw error;
  }
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, secret) as TokenPayload;
    logger.debug('Token verified', { userId: payload.userId });
    return payload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.debug('Token expired', { error: error.message });
      return null;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      logger.debug('Invalid token', { error: error.message });
      return null;
    }
    logger.error('Token verification failed', { error: String(error) });
    return null;
  }
}
