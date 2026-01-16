import { register, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

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

export const reportsGeneratedTotal = new Counter({
  name: 'reports_generated_total',
  help: 'Total reports generated',
  labelNames: ['type'],
  registers: [register],
});

export const reportGenerationDuration = new Histogram({
  name: 'report_generation_duration_seconds',
  help: 'Report generation time in seconds',
  labelNames: ['type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const kafkaMessagesConsumedTotal = new Counter({
  name: 'kafka_messages_consumed_total',
  help: 'Total Kafka messages consumed',
  labelNames: ['topic'],
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

export function recordReportGenerated(type: string): void {
  reportsGeneratedTotal.labels(type).inc();
}

export function recordReportGenerationDuration(type: string, duration: number): void {
  reportGenerationDuration.labels(type).observe(duration);
}

export function recordKafkaMessageConsumed(topic: string): void {
  kafkaMessagesConsumedTotal.labels(topic).inc();
}

export { register };
