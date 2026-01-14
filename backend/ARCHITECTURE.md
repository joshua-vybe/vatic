# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Frontend (Next.js/React)                           │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
        ┌──────────────────────┐  ┌──────────────────────┐
        │   REST API Calls     │  │   WebSocket Events   │
        └──────────────────────┘  └──────────────────────┘
                    │                         │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   AWS EKS Cluster      │
                    │   (Kubernetes)         │
                    │   + Istio Service Mesh │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Core Service    │  │ Market Data Svc  │  │ WebSocket Svc    │
│  (Port 3000)     │  │ (Port 3001)      │  │ (Port 3003)      │
│                  │  │                  │  │                  │
│ • Auth           │  │ • Ingestors      │  │ • Connections    │
│ • Users          │  │ • Normalizers    │  │ • Real-time      │
│ • Tiers          │  │ • Publishers     │  │ • Kafka Consumer │
│ • Purchases      │  │                  │  │                  │
│ • Assessments    │  │                  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   AWS MSK Kafka        │
                    │   (Event Streaming)    │
                    │                        │
                    │ • Market Data Topics   │
                    │ • Trading Topics       │
                    │ • Assessment Topics    │
                    │ • Rules Topics         │
                    │ • Payment Topics       │
                    │ • Monte Carlo Topics   │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Monte Carlo Svc  │  │ Report Service   │  │ (Future Services)│
│ (Port 3002)      │  │ (Port 3004)      │  │                  │
│                  │  │                  │  │                  │
│ • Orchestrator   │  │ • Generators     │  │                  │
│ • Ray Client     │  │ • Aggregators    │  │                  │
│ • Simulations    │  │ • Reports        │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
        │                        │
        └────────────────────────┼────────────────────────┐
                                 │                        │
                    ┌────────────▼────────────┐           │
                    │  CockroachDB Cloud     │           │
                    │  (Distributed SQL)     │           │
                    │                        │           │
                    │ • Users                │           │
                    │ • Sessions             │           │
                    │ • Tiers                │           │
                    │ • Purchases            │           │
                    │ • Assessments          │           │
                    │ • Positions            │           │
                    │ • Trades               │           │
                    │ • Rules & Violations   │           │
                    └────────────────────────┘           │
                                                         │
                    ┌────────────────────────┐           │
                    │ Redis Enterprise Cloud │◄──────────┘
                    │ (In-Memory Cache)      │
                    │                        │
                    │ • Session Cache        │
                    │ • Real-time Data       │
                    │ • Leaderboards         │
                    │ • Rate Limiting        │
                    └────────────────────────┘
```

## Service Responsibilities

### Core Service
**Primary Responsibilities:**
- User authentication and authorization
- User account management
- Tier management and pricing
- Purchase processing (Stripe integration)
- Assessment lifecycle management
- Virtual account management
- Rule checking and violation tracking

**Key Dependencies:**
- CockroachDB (persistent data)
- Redis (session cache, rate limiting)
- Stripe (payment processing)
- Kafka (event publishing)

**Exposed Endpoints:**
- `GET /health` - Health check
- `GET /ready` - Readiness check
- (Additional endpoints to be implemented)

### Market Data Service
**Primary Responsibilities:**
- Ingest market data from multiple sources
- Normalize data across different formats
- Publish normalized data to Kafka
- Handle WebSocket connections to data providers
- Manage data quality and validation

**Key Dependencies:**
- Kafka (event publishing)
- Redis (caching, rate limiting)
- External APIs (crypto exchanges, prediction markets)

**Data Sources:**
- Cryptocurrency exchanges (BTC, ETH, SOL)
- Prediction markets (Polymarket, Kalshi)
- Other financial data providers

### WebSocket Service
**Primary Responsibilities:**
- Maintain WebSocket connections with clients
- Consume events from Kafka
- Broadcast real-time updates to connected clients
- Handle connection lifecycle
- Manage message routing

**Key Dependencies:**
- Kafka (event consumption)
- Redis (connection state, pub/sub)
- Core Service (authentication)

**Event Types:**
- Market data updates
- Trading events
- Assessment status changes
- Rule violations

### Monte Carlo Service
**Primary Responsibilities:**
- Orchestrate Monte Carlo simulations
- Communicate with Ray Serve for distributed computing
- Process simulation results
- Publish simulation events to Kafka
- Store results in database

**Key Dependencies:**
- Kafka (event consumption/publishing)
- CockroachDB (result storage)
- Ray Serve (distributed computing)

**Simulation Types:**
- Risk analysis
- Strategy validation
- Drawdown projections
- Profit/loss scenarios

### Report Service
**Primary Responsibilities:**
- Generate assessment reports
- Aggregate trading statistics
- Create performance visualizations
- Store generated reports
- Provide report retrieval endpoints

**Key Dependencies:**
- Kafka (event consumption)
- CockroachDB (data retrieval)
- Redis (caching)

**Report Types:**
- Assessment summary
- Trade history
- Performance metrics
- Risk analysis
- Compliance report

## Data Flow

### Assessment Creation Flow
```
1. User purchases tier (Core Service)
   ↓
2. Payment processed (Stripe)
   ↓
3. Purchase event published (Kafka: payment.purchase-completed)
   ↓
4. Assessment created (Core Service)
   ↓
5. Assessment event published (Kafka: assessment.created)
   ↓
6. Virtual account initialized (Core Service)
   ↓
7. WebSocket clients notified (WebSocket Service)
```

### Trading Flow
```
1. User places trade (Core Service)
   ↓
2. Order event published (Kafka: trading.order-placed)
   ↓
3. Market data consumed (Market Data Service)
   ↓
4. Trade executed (Core Service)
   ↓
5. Trade event published (Kafka: trading.order-filled)
   ↓
6. Position updated (Core Service)
   ↓
7. Rule checks performed (Core Service)
   ↓
8. WebSocket clients notified (WebSocket Service)
```

### Rule Checking Flow
```
1. Trade executed (Core Service)
   ↓
2. Rule checks performed:
   - Max drawdown check
   - Min trades check
   - Max risk per trade check
   ↓
3. If violation detected:
   - Violation recorded (CockroachDB)
   - Event published (Kafka: rules.violation-detected)
   - WebSocket clients notified
   ↓
4. If assessment failed:
   - Assessment marked as failed
   - Event published (Kafka: assessment.abandoned)
```

### Report Generation Flow
```
1. Assessment completed (Core Service)
   ↓
2. Assessment event published (Kafka: assessment.completed)
   ↓
3. Report Service consumes event
   ↓
4. Aggregates trading data (CockroachDB)
   ↓
5. Generates visualizations
   ↓
6. Stores report (CockroachDB)
   ↓
7. Publishes report ready event (Kafka)
   ↓
8. WebSocket clients notified
```

## Technology Stack

### Runtime & Framework
- **Bun**: JavaScript runtime optimized for speed
- **Elysia**: Lightweight TypeScript web framework
- **TypeScript**: Type-safe development

### Databases
- **CockroachDB Cloud**: Distributed SQL database
  - Multi-region replication
  - ACID transactions
  - Horizontal scaling
- **Redis Enterprise Cloud**: In-memory data store
  - Session management
  - Real-time data
  - Caching

### Message Queue
- **AWS MSK (Kafka)**: Event streaming platform
  - Durable event log
  - Multi-partition topics
  - Consumer groups

### Cloud Infrastructure
- **AWS EKS**: Kubernetes cluster
  - Auto-scaling
  - High availability
  - Managed service
- **Istio**: Service mesh
  - Traffic management
  - Security (mTLS)
  - Observability

### Container Registry
- **AWS ECR**: Container image registry
  - Private repositories
  - Image scanning
  - Lifecycle policies

### Secrets Management
- **AWS Secrets Manager**: Centralized secrets
  - Encryption at rest
  - Rotation policies
  - Audit logging

## Deployment Architecture

### Local Development
```
Developer Machine
├── Core Service (localhost:3000)
├── Market Data Service (localhost:3001)
├── WebSocket Service (localhost:3003)
├── Monte Carlo Service (localhost:3002)
├── Report Service (localhost:3004)
├── PostgreSQL (Docker)
├── Redis (Docker)
└── Kafka (Docker)
```

### Production (AWS)
```
AWS EKS Cluster
├── Istio Service Mesh
│   ├── VirtualServices
│   ├── DestinationRules
│   └── PeerAuthentication (mTLS)
├── Core Service Pod (replicas: 1+)
├── Market Data Service Pod (replicas: 1+)
├── WebSocket Service Pod (replicas: 1+)
├── Monte Carlo Service Pod (replicas: 1+)
└── Report Service Pod (replicas: 1+)

AWS Managed Services
├── MSK Kafka Cluster (3 brokers)
├── CockroachDB Cloud (3 nodes)
├── Redis Enterprise Cloud (HA)
├── ECR (Container Registry)
└── Secrets Manager

Networking
├── VPC with public/private subnets
├── NAT Gateway for private subnet
├── Security Groups
└── VPC Peering (for databases)
```

## Scalability Considerations

### Horizontal Scaling
- **Kubernetes**: Auto-scaling based on CPU/memory
- **Kafka**: Partition-based parallelism
- **CockroachDB**: Automatic sharding
- **Redis**: Cluster mode for horizontal scaling

### Vertical Scaling
- **Pod Resources**: Increase CPU/memory limits
- **Node Types**: Upgrade to larger instance types
- **Database**: Increase compute/storage

### Performance Optimization
- **Caching**: Redis for frequently accessed data
- **Connection Pooling**: Reuse database connections
- **Batch Processing**: Aggregate operations
- **Compression**: LZ4 for Kafka messages

## Security Architecture

### Network Security
- **VPC Isolation**: Private subnets for services
- **Security Groups**: Restrict traffic by port/protocol
- **Network Policies**: Kubernetes network policies
- **Istio mTLS**: Encrypted service-to-service communication

### Authentication & Authorization
- **JWT Tokens**: Stateless authentication
- **RBAC**: Role-based access control
- **Service Accounts**: Kubernetes service accounts
- **IRSA**: IAM roles for service accounts

### Data Security
- **Encryption at Rest**: AWS KMS for databases
- **Encryption in Transit**: TLS for all connections
- **Secrets Management**: AWS Secrets Manager
- **Audit Logging**: CloudWatch logs

### Compliance
- **Data Retention**: Configurable retention policies
- **Backup & Recovery**: Automated backups
- **Access Logging**: All API calls logged
- **Secrets Rotation**: Automated rotation policies

## Monitoring & Observability

### Metrics
- **Pod Metrics**: CPU, memory, network
- **Application Metrics**: Request rate, latency, errors
- **Infrastructure Metrics**: Node health, disk usage
- **Business Metrics**: Assessments created, trades executed

### Logging
- **Application Logs**: Structured JSON logs
- **Infrastructure Logs**: EKS cluster logs
- **Audit Logs**: API call audit trail
- **Centralized Logging**: CloudWatch Logs

### Tracing
- **Distributed Tracing**: (To be implemented)
- **Request Correlation**: Correlation IDs
- **Service Dependencies**: Service map

### Alerting
- **Pod Restarts**: Alert on frequent restarts
- **Resource Usage**: Alert on high CPU/memory
- **Error Rates**: Alert on elevated error rates
- **Database Health**: Alert on connection failures

## Disaster Recovery

### Backup Strategy
- **Database**: Daily automated backups, 30-day retention
- **Redis**: AOF + RDB snapshots, 7-day retention
- **Kafka**: Topic replication factor 3
- **Container Images**: Retained in ECR

### Recovery Time Objectives (RTO)
- **Service Restart**: < 5 minutes
- **Database Recovery**: < 30 minutes
- **Full Cluster Recovery**: < 1 hour

### Recovery Point Objectives (RPO)
- **Database**: < 1 hour
- **Redis**: < 5 minutes
- **Kafka**: 0 (replicated)

## Future Enhancements

### Planned Features
- Distributed tracing with Jaeger
- Prometheus metrics collection
- Grafana dashboards
- Advanced monitoring and alerting
- Multi-region deployment
- Disaster recovery automation
- CI/CD pipeline integration
- Load testing framework
- Performance optimization
- Advanced caching strategies
