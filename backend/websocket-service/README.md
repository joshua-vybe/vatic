# WebSocket Service

Real-time WebSocket service for pushing trading and market data updates to connected clients. Consumes Kafka events and routes them to clients based on assessment_id.

## Architecture

```
┌─────────────┐
│   Kafka     │
│  (Events)   │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────┐
│   WebSocket Service                  │
│  ┌────────────────────────────────┐  │
│  │ Kafka Consumer                 │  │
│  │ (market-data.*, trading.*, ...) │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ Message Router                 │  │
│  │ (Route by assessment_id)       │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ Connection Manager             │  │
│  │ (Track active clients)         │  │
│  └────────────────────────────────┘  │
└──────┬───────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Frontend Clients                  │
│   (WebSocket connections)           │
└─────────────────────────────────────┘
```

## WebSocket Connection Protocol

### Connection URL
```
ws://localhost:3003/ws?token=<jwt>&assessmentId=<id>
```

### Query Parameters
- `token` (required): JWT token for authentication
- `assessmentId` (optional): Assessment ID for filtering updates

### Connection Flow

1. **Client connects** with JWT token
2. **Server verifies** token and extracts userId
3. **Server sends** welcome message with connectionId
4. **Server sends** periodic ping messages (every 30s)
5. **Client responds** with pong to keep connection alive
6. **Server routes** Kafka events to client based on assessmentId

### Message Types

#### Server → Client

**Connected Message**
```json
{
  "type": "connected",
  "connectionId": "uuid",
  "userId": "user-id",
  "timestamp": "2024-01-14T10:00:00Z"
}
```

**Ping Message**
```json
{
  "type": "ping",
  "timestamp": 1705238400000
}
```

**Market Price Update**
```json
{
  "type": "market_price",
  "market": "BTC",
  "price": 42500.50,
  "timestamp": "2024-01-14T10:00:00Z"
}
```

**P&L Update**
```json
{
  "type": "pnl_update",
  "assessmentId": "assessment-123",
  "unrealizedPnl": 1500.00,
  "realizedPnl": 500.00,
  "currentBalance": 10500.00,
  "timestamp": "2024-01-14T10:00:00Z"
}
```

**Position Update**
```json
{
  "type": "position_update",
  "assessmentId": "assessment-123",
  "positionId": "position-456",
  "market": "BTC",
  "side": "long",
  "quantity": 0.5,
  "entryPrice": 42000.00,
  "unrealizedPnl": 250.00,
  "timestamp": "2024-01-14T10:00:00Z"
}
```

**Rule Status Update**
```json
{
  "type": "rule_status",
  "assessmentId": "assessment-123",
  "rule": "drawdown",
  "value": 0.15,
  "threshold": 0.20,
  "status": "warning",
  "timestamp": "2024-01-14T10:00:00Z"
}
```

**Violation Alert**
```json
{
  "type": "violation",
  "assessmentId": "assessment-123",
  "rule": "drawdown_violation",
  "value": 0.25,
  "threshold": 0.20,
  "timestamp": "2024-01-14T10:00:00Z"
}
```

**Assessment Update**
```json
{
  "type": "assessment_update",
  "assessmentId": "assessment-123",
  "status": "failed",
  "timestamp": "2024-01-14T10:00:00Z"
}
```

#### Client → Server

**Pong Response**
```json
{
  "type": "pong",
  "timestamp": 1705238400000
}
```

## Heartbeat Mechanism

- Server sends ping every 30 seconds (configurable via `HEARTBEAT_INTERVAL`)
- Client must respond with pong within 60 seconds (configurable via `CONNECTION_TIMEOUT`)
- Connections that don't respond are automatically closed
- Prevents zombie connections and detects network issues

## Environment Variables

```bash
# Server
PORT=3003
NODE_ENV=production

# Kafka
KAFKA_BROKERS=kafka-1:9092,kafka-2:9092,kafka-3:9092
KAFKA_CLIENT_ID=websocket-service
KAFKA_GROUP_ID=websocket-service-group

# JWT
JWT_SECRET=your-secret-key

# Redis (optional, for future scaling)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional

# Timeouts
HEARTBEAT_INTERVAL=30000
CONNECTION_TIMEOUT=60000
```

## Local Development

### Prerequisites
- Bun runtime
- Kafka broker running
- Redis (optional)

### Setup

```bash
cd backend/websocket-service

# Install dependencies
bun install

# Set environment variables
export JWT_SECRET=dev-secret
export KAFKA_BROKERS=localhost:9092

# Run service
bun run src/index.ts
```

### Testing

```bash
# Run integration tests
bun test tests/integration.test.ts

# Test WebSocket connection
wscat -c "ws://localhost:3003/ws?token=<jwt>&assessmentId=test"
```

## Deployment

### Docker Build

```bash
docker build -t websocket-service:latest .
```

### Kubernetes Deployment

```bash
# Create ConfigMap
kubectl apply -f k8s/configmap.yaml

# Create Secrets
kubectl create secret generic websocket-secrets \
  --from-literal=jwt-secret=<your-secret> \
  --from-literal=redis-password=<optional>

# Deploy service
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml

# Deploy Istio resources (if using Istio)
kubectl apply -f k8s/istio-virtualservice.yaml
kubectl apply -f k8s/istio-destinationrule.yaml
```

### Scaling

The service supports horizontal scaling through:
- **Kubernetes HPA**: Auto-scales based on CPU (70%) and memory (80%) utilization
- **Consistent Hashing**: Distributes clients across replicas based on assessment_id
- **Session Affinity**: Sticky sessions ensure clients connect to same replica

## Monitoring

### Health Checks

```bash
# Liveness probe
curl http://localhost:3003/health

# Readiness probe
curl http://localhost:3003/ready
```

### Metrics

```bash
# Prometheus metrics
curl http://localhost:3003/metrics
```

Metrics include:
- `websocket_connections_total`: Active connections
- `websocket_messages_sent_total`: Messages sent to clients
- `websocket_messages_received_total`: Messages received from clients
- `websocket_kafka_messages_processed_total`: Kafka events processed
- `websocket_kafka_consumer_lag`: Consumer lag per topic
- `websocket_heartbeat_failures_total`: Failed heartbeats
- `websocket_connection_duration_seconds`: Connection duration histogram

## Troubleshooting

### Connections Dropping

1. Check heartbeat interval and timeout settings
2. Verify network connectivity between client and server
3. Check server logs for connection errors
4. Verify JWT token expiration

### High Memory Usage

1. Check number of active connections
2. Monitor message queue sizes
3. Verify Kafka consumer lag
4. Check for connection leaks

### Kafka Consumer Lag

1. Verify Kafka broker connectivity
2. Check consumer group status: `kafka-consumer-groups --describe --group websocket-service-group`
3. Monitor partition assignments
4. Check for processing errors in logs

## Architecture Decisions

### Bun + Elysia
- Native WebSocket support in Bun
- Lightweight and fast
- Consistent with Core Service framework

### Kafka Consumer
- Subscribes to multiple topics for different event types
- Processes events asynchronously
- Automatic reconnection on failures

### Connection Manager
- O(1) connection lookups by ID
- O(1) assessment_id lookups via secondary index
- Efficient memory usage with Map data structures

### Heartbeat Mechanism
- Detects stale connections
- Prevents zombie connections
- Configurable intervals for different environments

### Consistent Hashing
- Foundation for multi-replica deployments
- Distributes load based on assessment_id
- Enables future service discovery

## Future Enhancements

1. **Multi-Replica Coordination**: Use Redis pub/sub for replica coordination
2. **Message Compression**: Compress large messages before sending
3. **Rate Limiting**: Implement per-client rate limiting
4. **Message Buffering**: Buffer messages for temporarily disconnected clients
5. **Metrics Export**: Export metrics to Prometheus/Grafana
6. **Circuit Breaker**: Implement circuit breaker for Kafka consumer
7. **Client Authentication**: Support additional auth methods (API keys, OAuth)
