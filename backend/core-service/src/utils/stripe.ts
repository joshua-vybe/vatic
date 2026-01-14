import Stripe from 'stripe';
import { createLogger } from './logger';

const logger = createLogger('stripe');

let stripeClient: Stripe | null = null;

export interface StripePaymentIntentMetadata {
  userId: string;
  tierId: string;
}

export function initializeStripe(secretKey: string): Stripe {
  if (stripeClient) {
    return stripeClient;
  }

  stripeClient = new Stripe(secretKey);

  logger.info('Stripe client initialized');
  return stripeClient;
}

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    throw new Error('Stripe client not initialized. Call initializeStripe first.');
  }
  return stripeClient;
}
