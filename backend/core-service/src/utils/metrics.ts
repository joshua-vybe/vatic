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

export const kafkaConsumerLag = new Gauge({
  name: 'kafka_consumer_lag',
  help: 'Kafka consumer lag in messages',
  labelNames: ['topic', 'partition', 'group'],
  registers: [register],
});

export const redisOperationsTotal = new Counter({
  name: 'redis_operations_total',
  help: 'Total Redis operations',
  labelNames: ['operation', 'status'],
  registers: [register],
});

export const sagaExecutionsTotal = new Counter({
  name: 'saga_executions_total',
  help: 'Total saga executions',
  labelNames: ['saga_name', 'status'],
  registers: [register],
});

export const assessmentStateUpdatesTotal = new Counter({
  name: 'assessment_state_updates_total',
  help: 'Total assessment state updates',
  labelNames: ['state'],
  registers: [register],
});

export const ruleChecksTotal = new Counter({
  name: 'rule_checks_total',
  help: 'Total rule checks',
  labelNames: ['rule_type', 'status'],
  registers: [register],
});

export const cancelledPositionsPersistedTotal = new Counter({
  name: 'cancelled_positions_persisted_total',
  help: 'Total cancelled positions persisted to database',
  labelNames: ['status'],
  registers: [register],
});

export const cancelledTradesMarkedTotal = new Counter({
  name: 'cancelled_trades_marked_total',
  help: 'Total trades marked as cancelled',
  labelNames: ['status'],
  registers: [register],
});

export const cancelledPositionPersistenceDuration = new Histogram({
  name: 'cancelled_position_persistence_duration_seconds',
  help: 'Duration of cancelled position persistence operation in seconds',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const cancelledPositionsPendingPersistence = new Gauge({
  name: 'cancelled_positions_pending_persistence',
  help: 'Number of cancelled positions pending persistence to database',
  registers: [register],
});

export const cancelledPositionPersistenceDlqSize = new Gauge({
  name: 'cancelled_position_persistence_dlq_size',
  help: 'Size of dead letter queue for failed cancelled position persistence',
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

export function recordKafkaConsumerLag(topic: string, partition: number, group: string, lag: number): void {
  kafkaConsumerLag.labels(topic, String(partition), group).set(lag);
}

export function recordRedisOperation(operation: string, status: string): void {
  redisOperationsTotal.labels(operation, status).inc();
}

export function recordSagaExecution(sagaName: string, status: string): void {
  sagaExecutionsTotal.labels(sagaName, status).inc();
}

export function recordAssessmentStateUpdate(state: string): void {
  assessmentStateUpdatesTotal.labels(state).inc();
}

export function recordRuleCheck(ruleType: string, status: string): void {
  ruleChecksTotal.labels(ruleType, status).inc();
}

export function recordCancelledPositionPersisted(status: string): void {
  cancelledPositionsPersistedTotal.labels(status).inc();
}

export function recordCancelledTradesMarked(status: string): void {
  cancelledTradesMarkedTotal.labels(status).inc();
}

export function recordCancelledPositionPersistenceDuration(duration: number): void {
  cancelledPositionPersistenceDuration.observe(duration);
}

export function setCancelledPositionsPendingPersistence(count: number): void {
  cancelledPositionsPendingPersistence.set(count);
}

export function setCancelledPositionPersistenceDlqSize(size: number): void {
  cancelledPositionPersistenceDlqSize.set(size);
}

export { register };
