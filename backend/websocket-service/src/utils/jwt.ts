import { sign, verify } from 'jsonwebtoken';

export interface TokenPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  try {
    const payload = verify(token, secret) as TokenPayload;
    return payload;
  } catch (error) {
    return null;
  }
}

export function signToken(payload: TokenPayload, secret: string, expiresIn: string = '24h'): string {
  return sign(payload, secret, { expiresIn });
}
