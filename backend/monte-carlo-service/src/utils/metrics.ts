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

export const simulationJobsTotal = new Counter({
  name: 'simulation_jobs_total',
  help: 'Total simulation jobs',
  labelNames: ['status'],
  registers: [register],
});

export const simulationDuration = new Histogram({
  name: 'simulation_duration_seconds',
  help: 'Simulation execution time in seconds',
  labelNames: ['status'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [register],
});

export const rayServeRequestsTotal = new Counter({
  name: 'ray_serve_requests_total',
  help: 'Total Ray Serve API calls',
  labelNames: ['status'],
  registers: [register],
});

export const kafkaMessagesConsumedTotal = new Counter({
  name: 'kafka_messages_consumed_total',
  help: 'Total Kafka messages consumed',
  labelNames: ['topic'],
  registers: [register],
});

export const kafkaConsumerLag = new Gauge({
  name: 'kafka_consumer_lag',
  help: 'Kafka consumer lag in messages',
  labelNames: ['topic', 'partition', 'group'],
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

export function recordSimulationJob(status: string): void {
  simulationJobsTotal.labels(status).inc();
}

export function recordSimulationDuration(status: string, duration: number): void {
  simulationDuration.labels(status).observe(duration);
}

export function recordRayServeRequest(status: string): void {
  rayServeRequestsTotal.labels(status).inc();
}

export function recordKafkaMessageConsumed(topic: string): void {
  kafkaMessagesConsumedTotal.labels(topic).inc();
}

export function recordKafkaConsumerLag(topic: string, partition: number, group: string, lag: number): void {
  kafkaConsumerLag.labels(topic, String(partition), group).set(lag);
}

export { register };
