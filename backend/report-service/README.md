# Report Service

The Report Service generates comprehensive assessment reports by aggregating data from the Core Service and Monte Carlo Service. It consumes Kafka events to trigger report generation and enrichment.

## Overview

The service follows an event-driven architecture:
1. Listens for `assessment.completed` events to generate initial reports
2. Listens for `montecarlo.simulation-completed` events to enrich reports with simulation results
3. Exposes REST API endpoints for report retrieval

## Architecture

### Kafka Topics Consumed
- `assessment.completed`: Triggers initial report generation
- `montecarlo.simulation-completed`: Triggers report enrichment with Monte Carlo data

### Data Flow
1. Core Service publishes `assessment.completed` event
2. Report Service generates initial report with performance analytics
3. Monte Carlo Service publishes `montecarlo.simulation-completed` event
4. Report Service enriches report with simulation results
5. Frontend retrieves complete report via REST API

## API Endpoints

### Health Check
```
GET /health
```
Returns service health status.

### Readiness Check
```
GET /ready
```
Checks database and Kafka connectivity.

### Get Report
```
GET /reports/:assessment_id
```
Retrieves a report by assessment ID.

Response:
```json
{
  "report": {
    "summary": { ... },
    "tradeHistory": [ ... ],
    "pnlChart": [ ... ],
    "ruleCompliance": { ... },
    "marketBreakdown": [ ... ],
    "peerComparison": { ... },
    "monteCarlo": { ... }
  },
  "status": "complete"
}
```

## Environment Variables

- `DATABASE_URL`: CockroachDB connection string
- `KAFKA_BROKERS`: Comma-separated Kafka broker addresses
- `KAFKA_CLIENT_ID`: Kafka client identifier
- `KAFKA_GROUP_ID`: Kafka consumer group ID
- `CORE_SERVICE_URL`: Core Service base URL
- `MONTE_CARLO_SERVICE_URL`: Monte Carlo Service base URL
- `PORT`: HTTP server port (default: 3004)
- `NODE_ENV`: Environment (development/production)

## Local Development

### Setup
```bash
cd backend/report-service
bun install
cp .env.example .env
```

### Database Migration
```bash
bunx prisma migrate dev --name init
```

### Run Service
```bash
bun run dev
```

### Run Tests
```bash
bun test
bun test tests/integration.test.ts
```

## Deployment

### Docker Build
```bash
docker build -t report-service:latest .
```

### Kubernetes Deployment
```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

## Report Data Structure

Reports contain six main sections:

1. **Performance Summary**: Win rate, profit factor, P&L metrics
2. **Trade History**: Complete list of trades with details
3. **PnL Chart**: Cumulative P&L over time
4. **Rule Compliance**: Drawdown and risk-per-trade timelines
5. **Market Breakdown**: Performance by market type (crypto, polymarket, kalshi)
6. **Peer Comparison**: Percentile ranking within tier
7. **Monte Carlo Analysis**: Risk metrics and confidence intervals (added after simulation)

## Implementation Notes

- Reports are created with status "partial" on assessment completion
- Status is updated to "complete" when Monte Carlo data is available
- All analytics calculations handle edge cases (division by zero, empty datasets)
- Peer comparison uses tier-based percentile ranking
- Market types are inferred from market identifiers
