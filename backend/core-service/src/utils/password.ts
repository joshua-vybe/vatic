import bcrypt from 'bcrypt';
import { createLogger } from './logger';

const logger = createLogger('password');

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    logger.debug('Password hashed successfully');
    return hash;
  } catch (error) {
    logger.error('Failed to hash password', { error: String(error) });
    throw error;
  }
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  try {
    const match = await bcrypt.compare(password, hash);
    logger.debug('Password comparison completed', { match });
    return match;
  } catch (error) {
    logger.error('Failed to compare password', { error: String(error) });
    throw error;
  }
}
