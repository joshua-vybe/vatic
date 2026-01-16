import { getCorrelationId } from './correlation-id';
import { context, propagation } from '@opentelemetry/api';

/**
 * Wrapper for fetch that automatically adds correlation ID and trace context headers
 */
export async function fetchWithContext(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const correlationId = getCorrelationId();
  const headers = new Headers(options?.headers || {});

  // Add correlation ID header
  headers.set('X-Correlation-ID', correlationId);

  // Inject OpenTelemetry trace context
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  Object.entries(carrier).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return fetch(url, {
    ...options,
    headers,
  });
}
