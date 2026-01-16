import { createLogger } from './logger';

const logger = createLogger('circuit-breaker');

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private failureThreshold: number;
  private resetTimeout: number;
  private lastFailureTime: number | null = null;
  private name: string;

  constructor(
    name: string,
    failureThreshold: number = 3,
    resetTimeout: number = 60000
  ) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // If circuit is open, check if we should transition to half-open
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.lastFailureTime && Date.now() - this.lastFailureTime >= this.resetTimeout) {
        logger.info('Circuit breaker transitioning to HALF_OPEN', { name: this.name });
        this.state = CircuitBreakerState.HALF_OPEN;
      } else {
        logger.warn('Circuit breaker is OPEN, rejecting request', { name: this.name });
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      logger.info('Circuit breaker transitioning to CLOSED', { name: this.name });
      this.state = CircuitBreakerState.CLOSED;
    }
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      logger.warn('Circuit breaker transitioning to OPEN', {
        name: this.name,
        failureCount: this.failureCount,
      });
      this.state = CircuitBreakerState.OPEN;
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  reset(): void {
    logger.info('Circuit breaker reset', { name: this.name });
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}
