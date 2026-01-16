# Monte Carlo Service Deployment Guide

This guide covers the complete deployment of the Monte Carlo Service and Ray Serve cluster infrastructure.

## Prerequisites

- AWS EKS cluster running (see `INFRASTRUCTURE.md`)
- kubectl configured to access the cluster
- Docker installed locally
- AWS CLI configured
- Helm (optional, for KubeRay operator installation)

## Step 1: Deploy KubeRay Operator

The KubeRay operator manages Ray clusters on Kubernetes.

### Option A: Manual Deployment

```bash
# Apply KubeRay operator manifests
kubectl apply -f backend/infrastructure/kuberay/operator.yaml

# Verify operator is running
kubectl get pods -n ray-system
kubectl get crd rayclusters.ray.io
```

### Option B: Helm Installation

```bash
# Add KubeRay Helm repository
helm repo add kuberay https://ray-project.github.io/kuberay-helm/
helm repo update

# Install KubeRay operator
helm install kuberay-operator kuberay/kuberay-operator \
  --namespace ray-system \
  --create-namespace \
  --set image.tag=v0.5.0
```

## Step 2: Deploy Ray Cluster

Deploy the Ray cluster with head and worker nodes.

```bash
# Apply Ray cluster configuration
kubectl apply -f backend/infrastructure/kuberay/ray-cluster.yaml

# Verify cluster is running
kubectl get rayclusters
kubectl get pods -l ray.io/cluster=vatic-prop-ray

# Wait for all pods to be ready (may take 2-3 minutes)
kubectl wait --for=condition=ready pod -l ray.io/cluster=vatic-prop-ray --timeout=300s
```

## Step 3: Deploy Ray Serve Application

Deploy the Monte Carlo simulation endpoint to Ray Serve.

```bash
# Port-forward Ray head service for job submission
kubectl port-forward svc/ray-head-svc 8265:8265 &

# Submit Ray Serve deployment job
ray job submit --address http://localhost:8265 \
  -- python backend/infrastructure/kuberay/ray-serve-deployment.py

# Verify Ray Serve is running
kubectl port-forward svc/ray-head-svc 8000:8000 &
curl -X POST http://localhost:8000/simulate \
  -H "Content-Type: application/json" \
  -d '{"trade_history":[],"pnl_data":{"balance":10000,"peak":10000,"realized":0,"unrealized":0}}'
```

## Step 4: Create Database Schema

Initialize the Monte Carlo Service database schema.

```bash
# Navigate to service directory
cd backend/monte-carlo-service

# Generate Prisma client
bun run db:generate

# Run migrations
bun run db:migrate:dev

# Verify schema was created
# Connect to CockroachDB and check:
# SELECT * FROM information_schema.tables WHERE table_schema = 'public';
```

## Step 5: Build and Push Docker Image

Build the Monte Carlo Service Docker image and push to ECR.

```bash
# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1
ECR_REGISTRY=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# Create ECR repository
aws ecr create-repository \
  --repository-name monte-carlo-service \
  --region $REGION || true

# Authenticate Docker with ECR
aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ECR_REGISTRY

# Build Docker image
cd backend/monte-carlo-service
docker build -t monte-carlo-service:latest .

# Tag image
docker tag monte-carlo-service:latest \
  $ECR_REGISTRY/monte-carlo-service:latest

# Push image
docker push $ECR_REGISTRY/monte-carlo-service:latest
```

## Step 6: Create Kubernetes Secrets

Create secrets for sensitive configuration.

```bash
# Create secret for database URL
kubectl create secret generic monte-carlo-service-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=redis-password="$REDIS_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

# Verify secret was created
kubectl get secrets monte-carlo-service-secrets
```

## Step 7: Update Kubernetes Manifests

Update the deployment manifest with the correct ECR registry.

```bash
# Replace ECR_REGISTRY placeholder
sed -i "s|<ECR_REGISTRY>|$ECR_REGISTRY|g" \
  backend/monte-carlo-service/k8s/deployment.yaml

# Verify the change
grep image: backend/monte-carlo-service/k8s/deployment.yaml
```

## Step 8: Deploy to Kubernetes

Deploy the Monte Carlo Service to the EKS cluster.

```bash
# Apply ConfigMap
kubectl apply -f backend/monte-carlo-service/k8s/configmap.yaml

# Apply Service
kubectl apply -f backend/monte-carlo-service/k8s/service.yaml

# Apply Deployment
kubectl apply -f backend/monte-carlo-service/k8s/deployment.yaml

# Verify deployment
kubectl get deployments monte-carlo-service
kubectl get pods -l app=monte-carlo-service
kubectl get svc monte-carlo-service
```

## Step 9: Verify Deployment

Test the deployed service.

```bash
# Check pod status
kubectl get pods -l app=monte-carlo-service -o wide

# Check logs
kubectl logs -f deployment/monte-carlo-service

# Port-forward to test locally
kubectl port-forward svc/monte-carlo-service 3002:80 &

# Test health endpoint
curl http://localhost:3002/health

# Test readiness endpoint
curl http://localhost:3002/ready

# Test simulation trigger (will fail without Core Service, but shows connectivity)
curl -X POST http://localhost:3002/simulations \
  -H "Content-Type: application/json" \
  -d '{"assessmentId":"test-123"}'
```

## Step 10: Configure Monitoring

Set up monitoring and logging for the service.

```bash
# Check Prometheus metrics (if Prometheus is installed)
kubectl port-forward -n monitoring svc/prometheus 9090:9090 &

# View service metrics
curl http://localhost:3002/metrics

# Check logs in CloudWatch (if configured)
aws logs tail /aws/eks/monte-carlo-service --follow
```

## Troubleshooting

### Ray Cluster Issues

```bash
# Check Ray cluster status
kubectl describe raycluster vatic-prop-ray

# Check Ray head pod logs
kubectl logs -f deployment/vatic-prop-ray-head-group-0

# Check Ray worker pod logs
kubectl logs -f pod/vatic-prop-ray-worker-group-0-0

# Port-forward to Ray dashboard
kubectl port-forward svc/ray-head-svc 8265:8265
# Visit http://localhost:8265
```

### Monte Carlo Service Issues

```bash
# Check deployment status
kubectl describe deployment monte-carlo-service

# Check pod events
kubectl describe pod <pod-name>

# Check service connectivity
kubectl exec -it <pod-name> -- curl http://ray-head-svc:8000/health

# Check database connectivity
kubectl exec -it <pod-name> -- bun run "import { getPrismaClient } from './src/db'; const p = getPrismaClient(); await p.$queryRaw\`SELECT 1\`; console.log('OK')"
```

### Kafka Consumer Issues

```bash
# Check consumer group status
kafka-consumer-groups --bootstrap-server kafka:9092 \
  --group monte-carlo-service-group \
  --describe

# Reset consumer offset (if needed)
kafka-consumer-groups --bootstrap-server kafka:9092 \
  --group monte-carlo-service-group \
  --reset-offsets --to-earliest --execute
```

## Rollback

If deployment fails, rollback to previous version:

```bash
# Check rollout history
kubectl rollout history deployment/monte-carlo-service

# Rollback to previous version
kubectl rollout undo deployment/monte-carlo-service

# Rollback to specific revision
kubectl rollout undo deployment/monte-carlo-service --to-revision=1
```

## Scaling

Scale the Monte Carlo Service based on load:

```bash
# Manual scaling
kubectl scale deployment monte-carlo-service --replicas=5

# Horizontal Pod Autoscaler (if configured)
kubectl autoscale deployment monte-carlo-service \
  --min=2 --max=10 --cpu-percent=80

# Check HPA status
kubectl get hpa monte-carlo-service
```

## Next Steps

1. Configure Istio VirtualService and DestinationRule for traffic management
2. Set up monitoring dashboards in Grafana
3. Configure log aggregation in CloudWatch or ELK
4. Set up alerts for service health and performance
5. Document runbooks for common operational tasks
