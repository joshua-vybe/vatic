import Stripe from 'stripe';
import { getStripeClient } from '../utils/stripe';
import { createLogger } from '../utils/logger';

const logger = createLogger('stripe-integration');

/**
 * Create a payout using Stripe API
 */
export async function createPayout(
  amount: number,
  userId: string,
  metadata: Record<string, string>
): Promise<Stripe.Payout> {
  try {
    const stripeClient = getStripeClient();

    // Amount in cents
    const amountInCents = Math.round(amount * 100);

    const payout = await stripeClient.payouts.create({
      amount: amountInCents,
      currency: 'usd',
      method: 'instant',
      metadata: {
        userId,
        ...metadata,
      },
    });

    logger.info('Stripe payout created', {
      payoutId: payout.id,
      amount,
      userId,
      status: payout.status,
    });

    return payout;
  } catch (error) {
    logger.error('Failed to create Stripe payout', {
      amount,
      userId,
      error: String(error),
    });
    throw error;
  }
}

/**
 * Get payout status from Stripe
 */
export async function getPayoutStatus(payoutId: string): Promise<string> {
  try {
    const stripeClient = getStripeClient();

    const payout = await stripeClient.payouts.retrieve(payoutId);

    logger.debug('Payout status retrieved', {
      payoutId,
      status: payout.status,
    });

    return payout.status;
  } catch (error) {
    logger.error('Failed to retrieve payout status', {
      payoutId,
      error: String(error),
    });
    throw error;
  }
}
