# Secrets Management Guide

This document describes how to securely manage secrets for the Vatic Prop backend services using AWS Secrets Manager and IRSA (IAM Roles for Service Accounts).

## Overview

Secrets are managed through **AWS Secrets Manager** with **IRSA** (IAM Roles for Service Accounts) for secure, auditable access. Kubernetes secrets are **not** committed to version control to prevent credential exposure.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AWS Secrets Manager                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ vatic-prop/database                                  │  │
│  │ vatic-prop/redis                                     │  │
│  │ vatic-prop/kafka                                     │  │
│  │ vatic-prop/stripe                                    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         │ (IRSA)
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                    EKS Cluster                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Service Account: core-service-sa                     │  │
│  │ IAM Role: core-service-secrets-role                  │  │
│  │ Trust Relationship: OIDC Provider                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                         │                                   │
│                         ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Core Service Pod                                     │  │
│  │ - Loads secrets at startup                           │  │
│  │ - Uses AWS SDK with IRSA credentials                 │  │
│  │ - Populates environment variables                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## AWS Secrets Manager Setup

### 1. Create Secrets

Create secrets in AWS Secrets Manager for each service component:

```bash
# Database credentials
aws secretsmanager create-secret \
  --name vatic-prop/database \
  --description "CockroachDB credentials for core-service" \
  --secret-string '{
    "host": "cockroachdb-host.example.com",
    "port": "26257",
    "database": "core_service",
    "username": "core_service_user",
    "password": "strong_password_here",
    "sslmode": "require"
  }' \
  --region us-east-1

# Redis credentials
aws secretsmanager create-secret \
  --name vatic-prop/redis \
  --description "Redis Enterprise credentials" \
  --secret-string '{
    "host": "redis-host.example.com",
    "port": "6379",
    "password": "redis_password_here"
  }' \
  --region us-east-1

# Kafka configuration
aws secretsmanager create-secret \
  --name vatic-prop/kafka \
  --description "MSK Kafka broker configuration" \
  --secret-string '{
    "brokers": ["broker1:9092", "broker2:9092", "broker3:9092"],
    "clientId": "vatic-prop"
  }' \
  --region us-east-1

# Stripe API keys
aws secretsmanager create-secret \
  --name vatic-prop/stripe \
  --description "Stripe API credentials" \
  --secret-string '{
    "secretKey": "sk_live_...",
    "webhookSecret": "whsec_..."
  }' \
  --region us-east-1
```

### 2. Retrieve Secrets

```bash
# View secret value
aws secretsmanager get-secret-value \
  --secret-id vatic-prop/database \
  --region us-east-1

# Extract just the secret string
aws secretsmanager get-secret-value \
  --secret-id vatic-prop/database \
  --query SecretString \
  --output text \
  --region us-east-1
```

### 3. Update Secrets

```bash
# Update secret value
aws secretsmanager update-secret \
  --secret-id vatic-prop/database \
  --secret-string '{
    "host": "new-host.example.com",
    "port": "26257",
    "database": "core_service",
    "username": "core_service_user",
    "password": "new_password",
    "sslmode": "require"
  }' \
  --region us-east-1
```

### 4. Rotate Secrets

```bash
# Enable automatic rotation (requires Lambda function)
aws secretsmanager rotate-secret \
  --secret-id vatic-prop/database \
  --rotation-rules AutomaticallyAfterDays=30 \
  --region us-east-1
```

## IRSA Configuration

### 1. Create IAM Policy

Create `backend/infrastructure/iam-policy-secrets.json`:

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
        "arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:vatic-prop/*"
      ]
    }
  ]
}
```

### 2. Create IAM Role

```bash
# Create IAM policy
aws iam create-policy \
  --policy-name VaticPropSecretsPolicy \
  --policy-document file://backend/infrastructure/iam-policy-secrets.json \
  --region us-east-1

# Create IRSA (using eksctl)
eksctl create iamserviceaccount \
  --name core-service-sa \
  --namespace default \
  --cluster vatic-prop-eks \
  --attach-policy-arn arn:aws:iam::ACCOUNT_ID:policy/VaticPropSecretsPolicy \
  --approve \
  --region us-east-1
```

### 3. Verify IRSA

```bash
# Check service account annotation
kubectl get sa core-service-sa -o jsonpath='{.metadata.annotations.eks\.amazonaws\.com/role-arn}'

# Check IAM role trust relationship
aws iam get-role --role-name core-service-sa --query Role.AssumeRolePolicyDocument
```

## Kubernetes Configuration

### Service Account

The service account is created by IRSA setup:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: core-service-sa
  namespace: default
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT_ID:role/core-service-sa
```

### Deployment

The deployment references the service account but does NOT include secrets:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: core-service
  namespace: default
spec:
  template:
    spec:
      serviceAccountName: core-service-sa
      containers:
      - name: core-service
        image: vatic-prop-core-service:latest
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "3000"
        - name: AWS_REGION
          value: "us-east-1"
        # NO envFrom.secretRef - secrets loaded at runtime
```

## Application Configuration

### Startup Flow

The application loads secrets at startup:

```typescript
// 1. Load secrets from AWS Secrets Manager
const secrets = await loadSecrets();

// 2. Convert secrets to environment variables
const secretsConfig = buildConfigFromSecrets(secrets);

// 3. Merge with existing environment variables
Object.entries(secretsConfig).forEach(([key, value]) => {
  if (!process.env[key]) {
    process.env[key] = value;
  }
});

// 4. Load configuration
const config = loadConfig();

// 5. Initialize services with loaded configuration
initializeRedis(config.redisHost, config.redisPort, config.redisPassword);
```

### Environment Variables

Only non-sensitive environment variables are set in the deployment:

```yaml
env:
- name: NODE_ENV
  value: "production"
- name: PORT
  value: "3000"
- name: AWS_REGION
  value: "us-east-1"
```

Sensitive values are loaded from AWS Secrets Manager at runtime:
- `DATABASE_URL`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

## Deployment Instructions

### 1. Create AWS Secrets

```bash
# Create all secrets in AWS Secrets Manager
aws secretsmanager create-secret --name vatic-prop/database --secret-string '...'
aws secretsmanager create-secret --name vatic-prop/redis --secret-string '...'
aws secretsmanager create-secret --name vatic-prop/kafka --secret-string '...'
aws secretsmanager create-secret --name vatic-prop/stripe --secret-string '...'
```

### 2. Set Up IRSA

```bash
# Create IAM policy
aws iam create-policy \
  --policy-name VaticPropSecretsPolicy \
  --policy-document file://backend/infrastructure/iam-policy-secrets.json

# Create service account with IRSA
eksctl create iamserviceaccount \
  --name core-service-sa \
  --namespace default \
  --cluster vatic-prop-eks \
  --attach-policy-arn arn:aws:iam::ACCOUNT_ID:policy/VaticPropSecretsPolicy \
  --approve
```

### 3. Deploy Service

```bash
# Apply Kubernetes manifests (no secrets manifest)
kubectl apply -f backend/core-service/k8s/deployment.yaml
kubectl apply -f backend/core-service/k8s/service.yaml
kubectl apply -f backend/core-service/k8s/serviceaccount.yaml
kubectl apply -f backend/core-service/k8s/istio-virtualservice.yaml
kubectl apply -f backend/core-service/k8s/istio-destinationrule.yaml
kubectl apply -f backend/core-service/k8s/istio-peerauthentication.yaml

# Verify pod startup
kubectl get pods -l app=core-service
kubectl logs -f deployment/core-service
```

## Troubleshooting

### Pod fails to start with permission denied

**Symptoms:**
```
Error: AccessDenied: User: arn:aws:iam::ACCOUNT_ID:assumed-role/core-service-sa/...
is not authorized to perform: secretsmanager:GetSecretValue
```

**Solution:**
1. Verify IAM policy is attached to role
2. Check service account annotation
3. Verify OIDC provider is configured
4. Check secret ARN matches policy

```bash
# Verify IRSA setup
eksctl get iamserviceaccount --cluster vatic-prop-eks --namespace default

# Check role trust relationship
aws iam get-role --role-name core-service-sa --query Role.AssumeRolePolicyDocument
```

### Pod fails with "secret not found"

**Symptoms:**
```
Error: Failed to retrieve secret: vatic-prop/database
```

**Solution:**
1. Verify secret exists in AWS Secrets Manager
2. Check secret name matches exactly
3. Verify region is correct
4. Check IAM policy includes secret ARN

```bash
# List all secrets
aws secretsmanager list-secrets --region us-east-1

# Verify specific secret
aws secretsmanager describe-secret --secret-id vatic-prop/database --region us-east-1
```

### Pod fails with "invalid JSON in secret"

**Symptoms:**
```
Error: Unexpected token in JSON at position 0
```

**Solution:**
1. Verify secret value is valid JSON
2. Check for special characters or quotes
3. Validate JSON format

```bash
# Get secret and validate JSON
aws secretsmanager get-secret-value \
  --secret-id vatic-prop/database \
  --query SecretString \
  --output text | jq .
```

### Configuration not loading from secrets

**Symptoms:**
```
Error: Missing required environment variable: DATABASE_URL
```

**Solution:**
1. Check AWS_REGION environment variable is set
2. Verify IRSA credentials are available
3. Check pod logs for secret loading errors
4. Verify secret structure matches expected format

```bash
# Check pod logs
kubectl logs deployment/core-service -c core-service

# Verify environment variables
kubectl exec -it <pod-name> -- env | grep AWS
```

## Security Best Practices

### 1. Principle of Least Privilege
- IAM policy grants only `GetSecretValue` and `DescribeSecret`
- Policy restricted to `vatic-prop/*` secrets
- Service account limited to specific namespace

### 2. Audit Logging
- Enable CloudTrail for Secrets Manager API calls
- Monitor secret access in CloudWatch Logs
- Set up alerts for unauthorized access attempts

```bash
# Enable CloudTrail logging
aws cloudtrail create-trail \
  --name vatic-prop-secrets-trail \
  --s3-bucket-name vatic-prop-audit-logs \
  --is-multi-region-trail
```

### 3. Secret Rotation
- Implement automatic rotation for sensitive credentials
- Update application gracefully during rotation
- Monitor rotation failures

### 4. Encryption
- Secrets encrypted at rest using AWS KMS
- Encryption in transit using TLS
- Use customer-managed KMS keys for additional control

```bash
# Create customer-managed KMS key
aws kms create-key --description "Vatic Prop secrets encryption"

# Update secret to use custom KMS key
aws secretsmanager update-secret \
  --secret-id vatic-prop/database \
  --kms-key-id arn:aws:kms:us-east-1:ACCOUNT_ID:key/KEY_ID
```

### 5. Access Control
- Restrict who can view/modify secrets
- Use IAM policies to control access
- Enable MFA for sensitive operations

## Monitoring and Alerts

### CloudWatch Metrics

Monitor secret access:

```bash
# Create CloudWatch alarm for failed secret access
aws cloudwatch put-metric-alarm \
  --alarm-name vatic-prop-secrets-access-denied \
  --alarm-description "Alert on failed secret access" \
  --metric-name AccessDenied \
  --namespace AWS/SecretsManager \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold
```

### Logs

Check application logs for secret loading:

```bash
# View logs
kubectl logs deployment/core-service -c core-service

# Filter for secret-related logs
kubectl logs deployment/core-service -c core-service | grep -i secret

# Stream logs
kubectl logs -f deployment/core-service -c core-service
```

## Migration from Kubernetes Secrets

If migrating from Kubernetes secrets:

### 1. Create AWS Secrets

```bash
# Extract existing Kubernetes secret
kubectl get secret core-service-secrets -o jsonpath='{.data}' | base64 -d

# Create AWS Secrets Manager secret with same values
aws secretsmanager create-secret --name vatic-prop/database --secret-string '...'
```

### 2. Update Deployment

```bash
# Remove envFrom.secretRef from deployment
kubectl patch deployment core-service --type json -p '[
  {"op": "remove", "path": "/spec/template/spec/containers/0/envFrom"}
]'
```

### 3. Verify

```bash
# Check pod startup
kubectl get pods -l app=core-service

# Verify secrets are loaded
kubectl logs deployment/core-service | grep "Secrets loaded"
```

### 4. Clean Up

```bash
# Delete Kubernetes secret (after verification)
kubectl delete secret core-service-secrets
```

## References

- [AWS Secrets Manager Documentation](https://docs.aws.amazon.com/secretsmanager/)
- [IRSA Documentation](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)
- [eksctl IRSA Guide](https://eksctl.io/usage/iamserviceaccounts/)
- [AWS SDK for JavaScript](https://docs.aws.amazon.com/sdk-for-javascript/)
