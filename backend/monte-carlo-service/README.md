# Monte Carlo Service

Monte Carlo Service orchestrates distributed risk simulations via Ray Serve. It consumes assessment completion events, triggers simulations, stores results, and publishes completion events.

## Architecture

- **Kafka Consumer**: Listens for `assessment.completed` events
- **Job Manager**: Orchestrates simulation job lifecycle
- **Ray Serve HTTP Client**: Communicates with Ray Serve cluster for simulations
- **Cron Scheduler**: Triggers daily simulations for funded accounts
- **Kafka Publisher**: Publishes `montecarlo.simulation-completed` events

## Environment Variables

- `DATABASE_URL`: CockroachDB connection string (required)
- `REDIS_HOST`: Redis host (default: localhost)
- `REDIS_PORT`: Redis port (default: 6379)
- `REDIS_PASSWORD`: Redis password (optional)
- `KAFKA_BROKERS`: Comma-separated Kafka brokers (default: localhost:9092)
- `KAFKA_CLIENT_ID`: Kafka client ID (default: monte-carlo-service)
- `KAFKA_GROUP_ID`: Kafka consumer group ID (default: monte-carlo-service-group)
- `RAY_SERVE_URL`: Ray Serve endpoint (default: http://ray-head-svc:8000)
- `CORE_SERVICE_URL`: Core Service endpoint (default: http://core-service)
- `AWS_REGION`: AWS region (default: us-east-1)
- `PORT`: Service port (default: 3002)
- `NODE_ENV`: Environment (default: development)

## API Endpoints

### Health Check
```
GET /health
Response: { status: "ok" }
```

### Readiness Check
```
GET /ready
Response: { status: "ready" } or { status: "not_ready", error: "..." }
```

### Trigger Simulation
```
POST /simulations
Body: { assessmentId: string } or { fundedAccountId: string }
Response: { jobId: string }
```

### Get Simulation Result
```
GET /simulations/:id
Response: {
  id: string,
  assessmentId?: string,
  fundedAccountId?: string,
  status: "pending" | "running" | "completed" | "failed",
  inputData: object,
  result?: object,
  error?: string,
  createdAt: string,
  startedAt?: string,
  completedAt?: string
}
```

### List Simulations
```
GET /simulations?assessmentId=:id&status=:status
Response: { jobs: SimulationJob[] }
```

## Deployment

### Build Docker Image
```bash
docker build -t monte-carlo-service:latest .
docker tag monte-carlo-service:latest <ECR_REGISTRY>/monte-carlo-service:latest
docker push <ECR_REGISTRY>/monte-carlo-service:latest
```

### Apply Kubernetes Manifests
```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

## Database Setup

### Generate Prisma Client
```bash
bun run db:generate
```

### Run Migrations
```bash
bun run db:migrate:dev  # Development
bun run db:migrate      # Production
```

## Testing

### Run Integration Tests
```bash
bun test
```

## Troubleshooting

### Ray Serve Unreachable
- Verify Ray cluster is running: `kubectl get rayclusters`
- Check Ray head service: `kubectl get svc ray-head-svc`
- Port-forward for testing: `kubectl port-forward svc/ray-head-svc 8000:8000`

### Kafka Consumer Lag
- Check consumer group: `kafka-consumer-groups --bootstrap-server localhost:9092 --group monte-carlo-service-group --describe`
- Monitor topic: `kafka-topics --bootstrap-server localhost:9092 --topic assessment.completed --describe`

### Job Failures
- Check service logs: `kubectl logs -f deployment/monte-carlo-service`
- Verify database connectivity: `kubectl exec -it <pod> -- bun run "import { getPrismaClient } from './src/db'; const p = getPrismaClient(); await p.$queryRaw\`SELECT 1\`; console.log('OK')"`
- Check Ray Serve health: `curl http://ray-head-svc:8000/health`
