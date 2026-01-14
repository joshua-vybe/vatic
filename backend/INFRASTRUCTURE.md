# Vatic Prop Infrastructure Documentation

Comprehensive guide to cloud infrastructure, configuration, and deployment procedures.

## AWS EKS Cluster

### Cluster Configuration

- **Cluster Name**: `vatic-prop-eks`
- **Kubernetes Version**: 1.28 or later
- **Region**: `us-east-1`
- **VPC**: Custom VPC with public and private subnets across 3 AZs

### Node Group Configuration

- **Instance Type**: `t3.medium` (development), `t3.large` or `c5.xlarge` (production)
- **Desired Capacity**: 3 nodes
- **Min Nodes**: 3
- **Max Nodes**: 10
- **Disk Size**: 50 GB per node
- **Auto Scaling**: Enabled

### Network Configuration

- **Subnets**: Public and private subnets across 3 availability zones
- **NAT Gateway**: Enabled for private subnet internet access
- **Security Groups**:
  - Inbound: Ports 80, 443, 6443 (Kubernetes API)
  - Outbound: All traffic allowed

### IAM Roles and Policies

**EKS Cluster Role**:
- Policy: `AmazonEKSClusterPolicy`
- Allows cluster to manage AWS resources

**Node Group Role**:
- Policies:
  - `AmazonEKSWorkerNodePolicy`
  - `AmazonEC2ContainerRegistryReadOnly`
  - `AmazonEKS_CNI_Policy`

**Service Account Roles (IRSA)**:
- Core Service: `core-service-secrets-role`
  - Permissions: Read secrets from AWS Secrets Manager
  - Trust relationship: Kubernetes service account `core-service-sa`

### Access Configuration

```bash
# Configure kubectl
aws eks update-kubeconfig --region us-east-1 --name vatic-prop-eks

# Verify connectivity
kubectl get nodes

# Expected output: 3 nodes in Ready state
```

## Istio Service Mesh

### Installation

```bash
# Download Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-1.x.x

# Install with default profile
istioctl install --set profile=default -y

# Verify installation
kubectl get pods -n istio-system
```

### Configuration

**Namespace Sidecar Injection**:
```bash
# Enable automatic sidecar injection for default namespace
kubectl label namespace default istio-injection=enabled

# Verify label
kubectl get ns default --show-labels
```

**Traffic Management**:
- VirtualService: Routes traffic to services
- DestinationRule: Defines traffic policies (circuit breakers, connection pools)
- Retry policies: 3 retries with exponential backoff
- Timeout: 10 seconds per request

**Security**:
- mTLS: Enabled with STRICT mode for service-to-service communication
- PeerAuthentication: Enforces mutual TLS
- AuthorizationPolicy: (To be configured per service)

### Monitoring

```bash
# Check Istio components
kubectl get pods -n istio-system

# View Istio configuration
kubectl get virtualservices
kubectl get destinationrules
kubectl get gateways

# Check sidecar injection
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[*].name}'
# Should show: core-service istio-proxy
```

## AWS MSK Kafka Cluster

### Cluster Configuration

- **Cluster Name**: `vatic-prop-kafka`
- **Kafka Version**: 3.5.1 or later
- **Broker Instance Type**: `kafka.m5.large` (2 vCPU, 8 GB RAM)
- **Number of Brokers**: 3 (one per AZ)
- **Storage per Broker**: 100 GB EBS with provisioned throughput

### Network Configuration

- **VPC**: Same as EKS cluster
- **Subnets**: Private subnets across 3 AZs
- **Security Group**: Allows inbound traffic from EKS node security group on port 9092 (plaintext) or 9094 (TLS)

### Security Configuration

- **Encryption in Transit**: TLS enabled
- **Encryption at Rest**: AWS KMS enabled
- **Authentication**: IAM authentication for client connections
- **Broker-to-Broker**: TLS with mutual authentication

### Kafka Topics

**Market Data Topics** (3 partitions, 3 replication factor, 7-day retention):
```bash
kafka-topics.sh --create --topic market-data.btc-ticks --partitions 3 --replication-factor 3
kafka-topics.sh --create --topic market-data.eth-ticks --partitions 3 --replication-factor 3
kafka-topics.sh --create --topic market-data.sol-ticks --partitions 3 --replication-factor 3
kafka-topics.sh --create --topic market-data.polymarket-ticks --partitions 3 --replication-factor 3
kafka-topics.sh --create --topic market-data.kalshi-ticks --partitions 3 --replication-factor 3
```

**Trading Topics** (6 partitions, 3 replication factor, 30-day retention):
```bash
kafka-topics.sh --create --topic trading.order-placed --partitions 6 --replication-factor 3
kafka-topics.sh --create --topic trading.order-filled --partitions 6 --replication-factor 3
kafka-topics.sh --create --topic trading.position-opened --partitions 6 --replication-factor 3
kafka-topics.sh --create --topic trading.position-closed --partitions 6 --replication-factor 3
```

**Assessment Topics** (6 partitions, 3 replication factor, 30-day retention):
```bash
kafka-topics.sh --create --topic assessment.created --partitions 6 --replication-factor 3
kafka-topics.sh --create --topic assessment.started --partitions 6 --replication-factor 3
kafka-topics.sh --create --topic assessment.paused --partitions 6 --replication-factor 3
kafka-topics.sh --create --topic assessment.abandoned --partitions 6 --replication-factor 3
kafka-topics.sh --create --topic assessment.completed --partitions 6 --replication-factor 3
```

**Other Topics**:
```bash
kafka-topics.sh --create --topic rules.violation-detected --partitions 6 --replication-factor 3
kafka-topics.sh --create --topic payment.purchase-completed --partitions 3 --replication-factor 3
kafka-topics.sh --create --topic payment.purchase-failed --partitions 3 --replication-factor 3
kafka-topics.sh --create --topic montecarlo.simulation-started --partitions 3 --replication-factor 3
kafka-topics.sh --create --topic montecarlo.simulation-completed --partitions 3 --replication-factor 3
```

### Topic Configuration

- **Compression**: `lz4` for optimal performance
- **Partitioning Strategy**:
  - Market data topics: Partition by market
  - Trading/Assessment/Rules topics: Partition by `assessment_id`
- **Retention**: 7 days for market data, 30 days for business events

### Connection Details

- **Bootstrap Servers**: Obtained from AWS MSK console
- **Security Protocol**: TLS with IAM authentication
- **Client Configuration**: Use AWS SDK for IAM authentication

## CockroachDB Cloud

### Cluster Configuration

- **Cluster Name**: `vatic-prop-db`
- **Plan**: Dedicated (production) or Serverless (development)
- **Region**: `us-east-1`
- **Compute**: 2-4 vCPUs per node, 8-16 GB RAM
- **Storage**: 100 GB with automatic scaling
- **Nodes**: 3 nodes across 3 AZs (dedicated plan)

### Network Configuration

- **Whitelist IPs**: EKS cluster NAT Gateway IP addresses
- **Private Endpoint**: VPC peering for production
- **Connection String Format**: `postgresql://user:password@host:26257/database?sslmode=require`

### Database Schema

**Databases**:
- `core_service`: Core service data
- `market_data_service`: Market data (optional, can use Kafka)
- `monte_carlo_service`: Simulation results
- `report_service`: Generated reports

**Users**:
```sql
CREATE USER core_service_user WITH PASSWORD 'strong_password';
GRANT ALL ON DATABASE core_service TO core_service_user;

CREATE USER market_data_user WITH PASSWORD 'strong_password';
GRANT ALL ON DATABASE market_data_service TO market_data_user;

CREATE USER monte_carlo_user WITH PASSWORD 'strong_password';
GRANT ALL ON DATABASE monte_carlo_service TO monte_carlo_user;

CREATE USER report_user WITH PASSWORD 'strong_password';
GRANT ALL ON DATABASE report_service TO report_user;
```

### Connection Verification

```bash
# Connect to database
psql "postgresql://user:password@host:26257/database?sslmode=require"

# Verify connection
SELECT version();
```

## Redis Enterprise Cloud

### Cluster Configuration

- **Cluster Name**: `vatic-prop-redis`
- **Cloud Provider**: AWS
- **Region**: `us-east-1`
- **Plan**: Fixed size (2 GB development, 8-16 GB production)
- **High Availability**: Replication enabled (1 primary + 1 replica per shard)
- **Eviction Policy**: `noeviction` (fail writes when memory full)

### Persistence Configuration

**AOF (Append-Only File)**:
- Enabled: `appendonly yes`
- Fsync policy: `everysec` (fsync every second)
- AOF rewrite: Automatic when file grows 100% larger

**RDB Snapshots**:
- Snapshot frequency: `save 60 1` (every 60 seconds if 1 key changed)
- Additional: `save 300 10` (every 5 minutes if 10 keys changed)
- Additional: `save 900 1` (every 15 minutes if 1 key changed)
- Compression: Enabled

### Network Configuration

- **Whitelist IPs**: EKS cluster NAT Gateway IP addresses
- **VPC Peering**: Enabled for production
- **TLS**: Enabled for production
- **Authentication**: Strong password required

### Connection Details

- **Host**: Redis endpoint from console
- **Port**: 6379 (default)
- **Password**: Generated password
- **TLS**: Enable for production

## AWS Secrets Manager

### Secret Structure

**Database Credentials** (`vatic-prop/database`):
```json
{
  "host": "cockroachdb-host",
  "port": "26257",
  "database": "core_service",
  "username": "core_service_user",
  "password": "strong_password",
  "sslmode": "require"
}
```

**Redis Configuration** (`vatic-prop/redis`):
```json
{
  "host": "redis-host",
  "port": "6379",
  "password": "redis_password"
}
```

**Kafka Configuration** (`vatic-prop/kafka`):
```json
{
  "brokers": ["broker1:9092", "broker2:9092", "broker3:9092"],
  "clientId": "vatic-prop"
}
```

**Stripe API Keys** (`vatic-prop/stripe`):
```json
{
  "secretKey": "sk_test_...",
  "webhookSecret": "whsec_..."
}
```

### Creating Secrets

```bash
aws secretsmanager create-secret \
  --name vatic-prop/database \
  --secret-string '{"host":"...","port":"26257",...}'

aws secretsmanager create-secret \
  --name vatic-prop/redis \
  --secret-string '{"host":"...","port":"6379",...}'

aws secretsmanager create-secret \
  --name vatic-prop/kafka \
  --secret-string '{"brokers":[...],...}'

aws secretsmanager create-secret \
  --name vatic-prop/stripe \
  --secret-string '{"secretKey":"...","webhookSecret":"..."}'
```

### Retrieving Secrets

```bash
aws secretsmanager get-secret-value --secret-id vatic-prop/database
```

## IAM Roles and Policies

### Core Service Secrets Role

**Policy Name**: `VaticPropSecretsPolicy`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:us-east-1:<account-id>:secret:vatic-prop/*"
      ]
    }
  ]
}
```

### Creating IRSA

```bash
# Create IAM policy
aws iam create-policy \
  --policy-name VaticPropSecretsPolicy \
  --policy-document file://iam-policy-secrets.json

# Create IAM service account
eksctl create iamserviceaccount \
  --name core-service-sa \
  --namespace default \
  --cluster vatic-prop-eks \
  --attach-policy-arn arn:aws:iam::<account-id>:policy/VaticPropSecretsPolicy \
  --approve
```

## Container Registry (ECR)

### Repository Setup

```bash
# Create repository
aws ecr create-repository --repository-name vatic-prop-core-service

# Get login token
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Tag and push image
docker tag vatic-prop-core-service:latest \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/vatic-prop-core-service:latest

docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/vatic-prop-core-service:latest
```

### Image Lifecycle Policy

- Keep last 10 images
- Delete images older than 30 days
- Delete untagged images after 7 days

## Monitoring and Logging

### CloudWatch Logs

- EKS cluster logs: `/aws/eks/vatic-prop-eks/cluster`
- Application logs: Sent to CloudWatch via container stdout/stderr
- Log retention: 30 days

### Metrics

- EKS cluster metrics: CPU, memory, network
- Pod metrics: Via Kubernetes metrics server
- Application metrics: Custom metrics via CloudWatch

### Alerts

- Pod restart rate > 5 per hour
- Node CPU > 80%
- Node memory > 85%
- Database connection errors
- Kafka broker failures

## Disaster Recovery

### Backup Strategy

- **Database**: Automated daily backups, 30-day retention
- **Redis**: AOF + RDB snapshots, 7-day retention
- **Kafka**: Topic replication factor 3, 7-30 day retention

### Recovery Procedures

1. **Database Recovery**: Restore from backup via CockroachDB console
2. **Redis Recovery**: Restore from snapshot via Redis Enterprise console
3. **Kafka Recovery**: Rebalance partitions across healthy brokers
4. **EKS Recovery**: Redeploy services from container registry

## Deployment Checklist

- [ ] EKS cluster created and accessible
- [ ] Istio installed and sidecar injection enabled
- [ ] MSK cluster created with all topics
- [ ] CockroachDB cluster provisioned and accessible
- [ ] Redis Enterprise cluster provisioned and accessible
- [ ] Secrets created in AWS Secrets Manager
- [ ] IAM roles and IRSA configured
- [ ] ECR repositories created
- [ ] Container images built and pushed
- [ ] Kubernetes manifests applied
- [ ] Health checks passing
- [ ] Monitoring and logging configured
