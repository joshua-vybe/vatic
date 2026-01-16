# Vatic Prop Backend Microservices

A Bun + Elysia microservices architecture for the Vatic Prop trading assessment platform.

## Architecture Overview

The backend consists of 5 microservices deployed on AWS EKS with Istio service mesh:

- **Core Service** (Port 3000): User management, authentication, tier management, purchases, and assessment orchestration
- **Market Data Service** (Port 3001): Real-time market data ingestion from multiple sources (crypto, prediction markets)
- **Monte Carlo Service** (Port 3002): Distributed risk simulations via Ray Serve cluster
- **WebSocket Service** (Port 3003): Real-time bidirectional communication for live updates to connected clients
- **Report Service** (Port 3004): Assessment report generation and analytics

### Service Responsibilities

**WebSocket Service** handles:
- JWT-based WebSocket authentication
- Real-time event streaming from Kafka to connected clients
- Client connection state management with assessment_id routing
- Heartbeat mechanism for connection health monitoring
- Horizontal scaling through consistent hashing on assessment_id
- Prometheus metrics for monitoring and observability

### Infrastructure Components

- **AWS EKS**: Kubernetes cluster for service orchestration
- **AWS MSK**: Managed Kafka for event streaming
- **CockroachDB Cloud**: Distributed SQL database
- **Redis Enterprise Cloud**: In-memory data store for caching and real-time data
- **Istio**: Service mesh for traffic management and security
- **AWS Secrets Manager**: Centralized secrets management
- **KubeRay Operator**: Ray Serve cluster management on EKS

## Local Development Setup

### Prerequisites

- [Bun](https://bun.sh) (latest version)
- Node.js 18+ (for compatibility)
- Docker (for containerized testing)
- PostgreSQL client tools (for database access)

### Installation

1. Install dependencies:
```bash
cd backend
bun install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your local development values
```

3. For local database testing, you can use Docker:
```bash
# Start a local PostgreSQL instance
docker run -d \
  --name postgres-local \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=vatic_prop \
  -p 5432:5432 \
  postgres:15-alpine

# Update DATABASE_URL in .env
DATABASE_URL=postgresql://postgres:password@localhost:5432/vatic_prop?sslmode=disable
```

### Running Services Locally

Start individual services:

```bash
# Core Service
cd backend/core-service
bun run src/index.ts

# Market Data Service (in another terminal)
cd backend/market-data-service
bun run src/index.ts

# Monte Carlo Service (in another terminal)
cd backend/monte-carlo-service
bun run src/index.ts

# WebSocket Service (in another terminal)
cd backend/websocket-service
bun run src/index.ts

# Report Service (in another terminal)
cd backend/report-service
bun run src/index.ts
```

Or use the root workspace command:
```bash
bun run dev  # Starts core-service
```

### Database Migrations

Initialize Prisma and create migrations:

```bash
cd backend/core-service

# Generate Prisma client
bun run db:generate

# Create and apply migrations
bun run db:migrate

# Deploy migrations to production
bun run db:deploy

# Pull schema from database
bun run db:pull
```

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | CockroachDB connection string | `postgresql://user:pass@host:26257/db?sslmode=require` |
| `REDIS_HOST` | Redis server hostname | `redis-host.example.com` |
| `REDIS_PORT` | Redis server port | `6379` |
| `KAFKA_BROKERS` | Comma-separated Kafka broker addresses | `broker1:9092,broker2:9092` |
| `KAFKA_CLIENT_ID` | Kafka client identifier | `vatic-prop` |
| `AWS_REGION` | AWS region | `us-east-1` |
| `STRIPE_SECRET_KEY` | Stripe API secret key | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | `whsec_...` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Service port | `3000` |
| `REDIS_PASSWORD` | Redis authentication password | (none) |
| `AWS_SECRETS_MANAGER_ARN` | Secrets Manager ARN | (none) |
| `RAY_SERVE_URL` | Ray Serve endpoint | `http://ray-serve:8000` |

## Docker Build and Run

### Build Docker Image

```bash
cd backend/core-service
docker build -t vatic-prop-core-service:latest .
```

### Run Container

```bash
docker run -p 3000:3000 \
  --env-file .env \
  vatic-prop-core-service:latest
```

### Push to ECR

```bash
# Create ECR repository
aws ecr create-repository --repository-name vatic-prop-core-service

# Authenticate Docker
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag vatic-prop-core-service:latest \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/vatic-prop-core-service:latest

# Push image
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/vatic-prop-core-service:latest
```

## Kubernetes Deployment

### Prerequisites

- kubectl configured to access EKS cluster
- Istio installed on cluster
- AWS Secrets Manager configured with required secrets

### Deploy to EKS

```bash
# Apply all manifests for core-service
kubectl apply -f backend/core-service/k8s/

# Verify deployment
kubectl get pods -l app=core-service
kubectl logs -f deployment/core-service

# Check Istio sidecar injection
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[*].name}'
```

### Verify Service

```bash
# Port forward to test locally
kubectl port-forward svc/core-service 3000:80

# Test health endpoint
curl http://localhost:3000/health

# Test readiness endpoint
curl http://localhost:3000/ready
```

## Database Schema

The Core Service uses Prisma ORM with CockroachDB. Key models:

- **User**: User accounts with authentication
- **Session**: User sessions and tokens
- **Tier**: Trading assessment tiers (pricing and rules)
- **Purchase**: Tier purchases by users
- **Assessment**: Trading assessments with virtual accounts
- **VirtualAccount**: Virtual trading account for each assessment
- **Position**: Open/closed trading positions
- **Trade**: Individual trades within positions
- **RuleCheck**: Rule compliance checks
- **Violation**: Rule violations detected

See `backend/core-service/prisma/schema.prisma` for full schema definition.

## Kafka Topics

Market data and event topics are created on AWS MSK:

**Market Data Topics** (7-day retention):
- `market-data.btc-ticks`
- `market-data.eth-ticks`
- `market-data.sol-ticks`
- `market-data.polymarket-ticks`
- `market-data.kalshi-ticks`

**Trading Topics** (30-day retention):
- `trading.order-placed`
- `trading.order-filled`
- `trading.position-opened`
- `trading.position-closed`

**Assessment Topics** (30-day retention):
- `assessment.created`
- `assessment.started`
- `assessment.paused`
- `assessment.abandoned`
- `assessment.completed`

**Monte Carlo Topics** (30-day retention):
- `montecarlo.simulation-completed`

**Other Topics**:
- `rules.violation-detected`
- `payment.purchase-completed`
- `payment.purchase-failed`

## Troubleshooting

### Service won't start

1. Check environment variables are set correctly
2. Verify database connectivity: `psql $DATABASE_URL -c "SELECT 1"`
3. Verify Redis connectivity: `redis-cli -h $REDIS_HOST ping`
4. Check logs: `bun run src/index.ts 2>&1 | head -50`

### Database migration fails

1. Ensure DATABASE_URL is correct
2. Check database user has necessary permissions
3. Review migration files in `prisma/migrations/`
4. Run `bun run db:pull` to sync schema

### Kubernetes pod not starting

1. Check pod status: `kubectl describe pod <pod-name>`
2. Check logs: `kubectl logs <pod-name>`
3. Verify secrets exist: `kubectl get secrets`
4. Check resource limits: `kubectl top pods`

### Istio sidecar not injecting

1. Verify namespace label: `kubectl get ns default --show-labels`
2. Enable injection: `kubectl label namespace default istio-injection=enabled`
3. Restart pod: `kubectl rollout restart deployment/core-service`

## Service Endpoints

### Core Service

- `GET /health` - Health check
- `GET /ready` - Readiness check

### Market Data Service

- `GET /health` - Health check
- `GET /ready` - Readiness check

### WebSocket Service

- `WS /ws` - WebSocket endpoint for real-time updates
- `GET /health` - Health check
- `GET /ready` - Readiness check
- `GET /metrics` - Prometheus metrics

See `backend/websocket-service/README.md` for WebSocket protocol details.

### Report Service

- `GET /health` - Health check
- `GET /ready` - Readiness check

### Monte Carlo Service

- `GET /health` - Health check
- `GET /ready` - Readiness check
- `POST /simulations` - Trigger simulation
- `GET /simulations/:id` - Get simulation result
- `GET /simulations` - List simulations

See `backend/monte-carlo-service/README.md` for detailed API documentation.

## Development Workflow

1. Create feature branch
2. Make changes to service code
3. Test locally with `bun run dev`
4. Run database migrations if schema changed
5. Build Docker image and test
6. Push to ECR
7. Deploy to EKS with kubectl
8. Verify with health/ready endpoints

## Additional Resources

- [Elysia Documentation](https://elysiajs.com)
- [Bun Documentation](https://bun.sh/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [AWS EKS Documentation](https://docs.aws.amazon.com/eks/)
- [Istio Documentation](https://istio.io/latest/docs/)
