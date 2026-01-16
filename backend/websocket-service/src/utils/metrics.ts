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

export const websocketConnectionsTotal = new Gauge({
  name: 'websocket_connections_total',
  help: 'Total active WebSocket connections',
  registers: [register],
});

export const websocketMessagesSentTotal = new Counter({
  name: 'websocket_messages_sent_total',
  help: 'Total messages sent to clients',
  registers: [register],
});

export const websocketMessagesReceivedTotal = new Counter({
  name: 'websocket_messages_received_total',
  help: 'Total messages received from clients',
  registers: [register],
});

export const kafkaMessagesConsumedTotal = new Counter({
  name: 'kafka_messages_consumed_total',
  help: 'Total Kafka messages consumed',
  labelNames: ['topic'],
  registers: [register],
});

export const websocketHeartbeatFailuresTotal = new Counter({
  name: 'websocket_heartbeat_failures_total',
  help: 'Total heartbeat failures',
  registers: [register],
});

export const websocketConnectionDuration = new Histogram({
  name: 'websocket_connection_duration_seconds',
  help: 'WebSocket connection duration in seconds',
  buckets: [1, 5, 10, 30, 60, 300, 600, 1800, 3600],
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

export function recordConnectionOpened(): void {
  websocketConnectionsTotal.inc();
}

export function recordConnectionClosed(durationSeconds: number): void {
  websocketConnectionsTotal.dec();
  websocketConnectionDuration.observe(durationSeconds);
}

export function recordMessageSent(): void {
  websocketMessagesSentTotal.inc();
}

export function recordMessageReceived(): void {
  websocketMessagesReceivedTotal.inc();
}

export function recordKafkaMessageConsumed(topic: string): void {
  kafkaMessagesConsumedTotal.labels(topic).inc();
}

export function recordHeartbeatFailure(): void {
  websocketHeartbeatFailuresTotal.inc();
}

export function recordKafkaConsumerLag(topic: string, partition: number, group: string, lag: number): void {
  kafkaConsumerLag.labels(topic, String(partition), group).set(lag);
}

export class MetricsCollector {
  recordConnectionOpened(): void {
    recordConnectionOpened();
  }

  recordConnectionClosed(durationSeconds: number): void {
    recordConnectionClosed(durationSeconds);
  }

  recordMessageSent(): void {
    recordMessageSent();
  }

  recordMessageReceived(): void {
    recordMessageReceived();
  }

  recordKafkaMessageProcessed(): void {
    recordKafkaMessageConsumed('processed');
  }

  recordHeartbeatFailure(): void {
    recordHeartbeatFailure();
  }

  recordConnectionByAssessment(assessmentId: string, delta: number): void {
    // Track connections per assessment (can be extended with a gauge if needed)
    // For now, this is a no-op as the main connection count is tracked globally
  }
}

export { register };

