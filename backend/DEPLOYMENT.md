# Deployment Guide

Step-by-step instructions for deploying Vatic Prop backend services to AWS EKS.

## Prerequisites

- AWS account with appropriate permissions
- `aws-cli` configured with credentials
- `kubectl` installed and configured
- `docker` installed for building images
- `eksctl` installed for EKS management
- `istioctl` installed for Istio management

## Phase 1: Infrastructure Setup

### 1.1 Create EKS Cluster

```bash
# Create cluster with eksctl
eksctl create cluster \
  --name vatic-prop-eks \
  --region us-east-1 \
  --version 1.28 \
  --nodegroup-name vatic-prop-nodes \
  --node-type t3.medium \
  --nodes 3 \
  --nodes-min 3 \
  --nodes-max 10 \
  --managed

# Verify cluster
kubectl get nodes
```

### 1.2 Install Istio

```bash
# Download Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-1.x.x

# Install Istio
istioctl install --set profile=default -y

# Enable sidecar injection
kubectl label namespace default istio-injection=enabled

# Verify installation
kubectl get pods -n istio-system
```

### 1.3 Create MSK Kafka Cluster

```bash
# Via AWS Console or AWS CLI
aws kafka create-cluster \
  --cluster-name vatic-prop-kafka \
  --kafka-version 3.5.1 \
  --number-of-broker-nodes 3 \
  --broker-node-group-info \
    InstanceType=kafka.m5.large,\
    ClientSubnets=subnet-xxx,subnet-yyy,subnet-zzz,\
    SecurityGroups=sg-xxx,\
    StorageInfo={EbsStorageInfo={VolumeSize=100}} \
  --region us-east-1

# Create topics (after cluster is ready)
# See INFRASTRUCTURE.md for topic creation commands
```

### 1.4 Provision CockroachDB Cloud

1. Go to [CockroachDB Cloud Console](https://cockroachlabs.cloud)
2. Create new cluster:
   - Name: `vatic-prop-db`
   - Plan: Dedicated
   - Region: `us-east-1`
   - Compute: 2 vCPU, 8 GB RAM
   - Nodes: 3
3. Whitelist EKS NAT Gateway IP
4. Create SQL users (see INFRASTRUCTURE.md)
5. Note connection string

### 1.5 Provision Redis Enterprise Cloud

1. Go to [Redis Enterprise Cloud Console](https://app.redislabs.com)
2. Create new subscription:
   - Name: `vatic-prop-redis`
   - Cloud: AWS
   - Region: `us-east-1`
   - Plan: Fixed (8 GB)
3. Create database with persistence enabled
4. Whitelist EKS NAT Gateway IP
5. Note connection details

### 1.6 Create AWS Secrets Manager Secrets

```bash
# Database secret
aws secretsmanager create-secret \
  --name vatic-prop/database \
  --secret-string '{
    "host": "cockroachdb-host",
    "port": "26257",
    "database": "core_service",
    "username": "core_service_user",
    "password": "strong_password",
    "sslmode": "require"
  }'

# Redis secret
aws secretsmanager create-secret \
  --name vatic-prop/redis \
  --secret-string '{
    "host": "redis-host",
    "port": "6379",
    "password": "redis_password"
  }'

# Kafka secret
aws secretsmanager create-secret \
  --name vatic-prop/kafka \
  --secret-string '{
    "brokers": ["broker1:9092", "broker2:9092", "broker3:9092"],
    "clientId": "vatic-prop"
  }'

# Stripe secret
aws secretsmanager create-secret \
  --name vatic-prop/stripe \
  --secret-string '{
    "secretKey": "sk_test_...",
    "webhookSecret": "whsec_..."
  }'
```

### 1.7 Set Up IAM Roles for Service Accounts

```bash
# Create IAM policy
aws iam create-policy \
  --policy-name VaticPropSecretsPolicy \
  --policy-document file://backend/infrastructure/iam-policy-secrets.json

# Create IRSA for core-service
eksctl create iamserviceaccount \
  --name core-service-sa \
  --namespace default \
  --cluster vatic-prop-eks \
  --attach-policy-arn arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/VaticPropSecretsPolicy \
  --approve
```

## Phase 2: Container Registry Setup

### 2.1 Create ECR Repositories

```bash
# Create repository for each service
for service in core-service market-data-service monte-carlo-service websocket-service report-service; do
  aws ecr create-repository \
    --repository-name vatic-prop-$service \
    --region us-east-1
done
```

### 2.2 Build and Push Images

```bash
# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1

# Authenticate Docker
aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# Build and push core-service
cd backend/core-service
docker build -t vatic-prop-core-service:latest .
docker tag vatic-prop-core-service:latest \
  $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/vatic-prop-core-service:latest
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/vatic-prop-core-service:latest

# Repeat for other services...
```

## Phase 3: Database Setup

### 3.1 Initialize Database Schema

```bash
# Connect to CockroachDB
psql "postgresql://user:password@host:26257/core_service?sslmode=require"

# Create databases
CREATE DATABASE core_service;
CREATE DATABASE market_data_service;
CREATE DATABASE monte_carlo_service;
CREATE DATABASE report_service;

# Create users
CREATE USER core_service_user WITH PASSWORD 'strong_password';
GRANT ALL ON DATABASE core_service TO core_service_user;

CREATE USER market_data_user WITH PASSWORD 'strong_password';
GRANT ALL ON DATABASE market_data_service TO market_data_user;

CREATE USER monte_carlo_user WITH PASSWORD 'strong_password';
GRANT ALL ON DATABASE monte_carlo_service TO monte_carlo_user;

CREATE USER report_user WITH PASSWORD 'strong_password';
GRANT ALL ON DATABASE report_service TO report_user;
```

### 3.2 Run Prisma Migrations

```bash
cd backend/core-service

# Generate Prisma client
bun run db:generate

# Create and apply migrations
bun run db:migrate

# Verify schema
bun run db:pull
```

## Phase 4: Kubernetes Deployment

### 4.1 Create Kubernetes Secrets

```bash
# Create secret from AWS Secrets Manager
kubectl create secret generic core-service-secrets \
  --from-literal=DATABASE_URL="postgresql://user:password@host:26257/core_service?sslmode=require" \
  --from-literal=REDIS_HOST="redis-host" \
  --from-literal=REDIS_PORT="6379" \
  --from-literal=REDIS_PASSWORD="redis_password" \
  --from-literal=KAFKA_BROKERS="broker1:9092,broker2:9092,broker3:9092" \
  --from-literal=KAFKA_CLIENT_ID="vatic-prop" \
  --from-literal=AWS_REGION="us-east-1" \
  --from-literal=STRIPE_SECRET_KEY="sk_test_..." \
  --from-literal=STRIPE_WEBHOOK_SECRET="whsec_..."
```

### 4.2 Update Kubernetes Manifests

Update image references in `backend/core-service/k8s/deployment.yaml`:

```yaml
image: <account-id>.dkr.ecr.us-east-1.amazonaws.com/vatic-prop-core-service:latest
```

Update service account role ARN in `backend/core-service/k8s/serviceaccount.yaml`:

```yaml
eks.amazonaws.com/role-arn: arn:aws:iam::<account-id>:role/core-service-sa
```

### 4.3 Deploy Services

```bash
# Deploy core-service
kubectl apply -f backend/core-service/k8s/

# Verify deployment
kubectl get pods -l app=core-service
kubectl logs -f deployment/core-service

# Check Istio sidecar
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[*].name}'
```

### 4.4 Verify Deployment

```bash
# Port forward to test
kubectl port-forward svc/core-service 3000:80

# Test health endpoint
curl http://localhost:3000/health

# Test readiness endpoint
curl http://localhost:3000/ready

# Check logs
kubectl logs -f deployment/core-service
```

## Phase 5: Validation

### 5.1 Health Checks

```bash
# Check all pods running
kubectl get pods

# Check pod resource usage
kubectl top pods

# Check node status
kubectl get nodes

# Check Istio status
kubectl get pods -n istio-system
```

### 5.2 Connectivity Tests

```bash
# Test database connectivity
kubectl run -it --rm debug --image=postgres:15-alpine --restart=Never -- \
  psql "postgresql://user:password@host:26257/core_service?sslmode=require" -c "SELECT 1"

# Test Redis connectivity
kubectl run -it --rm debug --image=redis:7-alpine --restart=Never -- \
  redis-cli -h redis-host ping

# Test Kafka connectivity
kubectl run -it --rm debug --image=confluentinc/cp-kafka:7.5.0 --restart=Never -- \
  kafka-broker-api-versions.sh --bootstrap-server broker1:9092
```

### 5.3 Application Tests

```bash
# Test health endpoint
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://core-service/health

# Test readiness endpoint
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://core-service/ready
```

## Phase 6: Monitoring Setup

### 6.1 Enable CloudWatch Logs

```bash
# Enable EKS cluster logging
aws eks update-cluster-config \
  --name vatic-prop-eks \
  --logging '{"clusterLogging":[{"enabled":true,"types":["api","audit","authenticator","controllerManager","scheduler"]}]}'
```

### 6.2 Configure Application Logging

Applications log to stdout/stderr, which are automatically captured by CloudWatch.

### 6.3 Set Up Alarms

```bash
# Pod restart alarm
aws cloudwatch put-metric-alarm \
  --alarm-name vatic-prop-pod-restarts \
  --alarm-description "Alert when pods restart frequently" \
  --metric-name PodRestarts \
  --namespace EKS \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold
```

## Rollback Procedures

### Rollback Deployment

```bash
# View deployment history
kubectl rollout history deployment/core-service

# Rollback to previous version
kubectl rollout undo deployment/core-service

# Rollback to specific revision
kubectl rollout undo deployment/core-service --to-revision=2
```

### Rollback Database

```bash
# Revert migration
cd backend/core-service
bun run prisma migrate resolve --rolled-back <migration-name>
```

## Troubleshooting

### Pod not starting

```bash
# Check pod status
kubectl describe pod <pod-name>

# Check logs
kubectl logs <pod-name>

# Check events
kubectl get events --sort-by='.lastTimestamp'
```

### Database connection issues

```bash
# Verify secret
kubectl get secret core-service-secrets -o yaml

# Test connection
kubectl run -it --rm debug --image=postgres:15-alpine --restart=Never -- \
  psql $DATABASE_URL -c "SELECT 1"
```

### Istio sidecar not injecting

```bash
# Check namespace label
kubectl get ns default --show-labels

# Enable injection
kubectl label namespace default istio-injection=enabled

# Restart pod
kubectl rollout restart deployment/core-service
```

## Maintenance

### Regular Tasks

- Monitor pod resource usage
- Review CloudWatch logs for errors
- Update container images monthly
- Backup database weekly
- Review and rotate secrets quarterly

### Scaling

```bash
# Scale deployment
kubectl scale deployment core-service --replicas=3

# Enable horizontal pod autoscaling
kubectl autoscale deployment core-service --min=2 --max=10 --cpu-percent=80
```

## Disaster Recovery

### Backup Procedures

- Database: Automated daily backups via CockroachDB
- Redis: Automated snapshots via Redis Enterprise
- Kafka: Topic replication factor 3
- Container images: Retained in ECR

### Recovery Procedures

1. **Database**: Restore from backup via CockroachDB console
2. **Redis**: Restore from snapshot via Redis Enterprise console
3. **Services**: Redeploy from container registry
4. **Kafka**: Rebalance partitions across healthy brokers
