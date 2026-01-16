import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

collectDefaultMetrics({ register });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const kafkaMessagesPublishedTotal = new Counter({
  name: 'kafka_messages_published_total',
  help: 'Total Kafka messages published',
  labelNames: ['topic'],
  registers: [register],
});

export const kafkaPublishErrorsTotal = new Counter({
  name: 'kafka_publish_errors_total',
  help: 'Total Kafka publish errors',
  labelNames: ['topic'],
  registers: [register],
});

export const ingestorRunning = new Gauge({
  name: 'market_data_ingestor_running',
  help: 'Ingestor running state (1=running, 0=stopped)',
  labelNames: ['ingestor'],
  registers: [register],
});

export const circuitBreakerState = new Gauge({
  name: 'market_data_circuit_breaker_state',
  help: 'Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
  labelNames: ['ingestor'],
  registers: [register],
});

export function recordHttpRequest(
  method: string,
  route: string,
  status: number,
  duration: number
): void {
  httpRequestDuration.labels(method, route, String(status)).observe(duration);
  httpRequestsTotal.labels(method, route, String(status)).inc();
}

export function recordKafkaPublish(topic: string): void {
  kafkaMessagesPublishedTotal.labels(topic).inc();
}

export function recordKafkaPublishError(topic: string): void {
  kafkaPublishErrorsTotal.labels(topic).inc();
}

export function setIngestorRunning(ingestor: 'coingecko' | 'polymarket' | 'kalshi', running: boolean): void {
  ingestorRunning.labels(ingestor).set(running ? 1 : 0);
}

export function setCircuitBreakerState(
  ingestor: 'coingecko' | 'polymarket' | 'kalshi',
  state: string
): void {
  const stateValue = state === 'CLOSED' ? 0 : state === 'OPEN' ? 1 : 2;
  circuitBreakerState.labels(ingestor).set(stateValue);
}

export { register };

