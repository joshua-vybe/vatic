import { Elysia } from 'elysia';
import { generateCorrelationId, setCorrelationId } from '../utils/correlation-id';

export function correlationIdMiddleware(app: Elysia): Elysia {
  return app.derive(({ headers }) => {
    const correlationId = headers['x-correlation-id'] || generateCorrelationId();
    setCorrelationId(correlationId);
    return { correlationId };
  });
}
