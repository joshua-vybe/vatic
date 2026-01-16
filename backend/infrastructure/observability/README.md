# Observability Stack

Complete observability implementation for the Vatic Prop trading platform using the three pillars: metrics, logs, and traces.

## Architecture Overview

The observability stack consists of:

1. **Prometheus**: Metrics collection and storage
2. **Grafana**: Metrics visualization and dashboards
3. **Jaeger**: Distributed tracing
4. **Fluentd**: Log aggregation to CloudWatch
5. **Alertmanager**: Alert routing and notifications

## Components

### Prometheus
- **Namespace**: `monitoring`
- **Scrape Interval**: 15 seconds
- **Retention**: 15 days
- **Storage**: 50Gi persistent volume
- **Targets**: All 5 microservices

**Access**: `http://localhost:9090` (after port-forward)

### Grafana
- **Port**: 3000
- **Default Credentials**: admin/admin
- **Storage**: 10Gi persistent volume
- **Dashboards**:
  - Latency Dashboard: p50, p95, p99 latency metrics
  - Throughput Dashboard: Requests/sec, Kafka messages
  - Error Dashboard: Error rates, status codes, circuit breaker state
  - Kafka Dashboard: Consumer lag, queue depth, partition distribution

**Access**: `http://localhost:3000` (after port-forward)

### Jaeger
- **UI Port**: 16686
- **Collector Port**: 14268
- **Agent Port**: 6831 (UDP)
- **Sampling**: 10% probabilistic (development), 1% (production)
- **Trace Retention**: 7 days

**Access**: `http://localhost:16686` (after port-forward)

### Alertmanager
- **Port**: 9093
- **Notification Channels**: Slack, PagerDuty, Email
- **Alert Routing**: Critical → PagerDuty, Warning → Slack

## Deployment

### Prerequisites
- EKS cluster with Prometheus Operator CRDs installed
- AWS credentials configured for CloudWatch access
- Slack webhook URL (optional, for notifications)
- PagerDuty service key (optional, for critical alerts)

### Step 1: Create Monitoring Namespace
```bash
kubectl apply -f prometheus/namespace.yaml
```

### Step 2: Deploy Prometheus Operator
```bash
kubectl apply -f prometheus/prometheus-operator.yaml
```

### Step 3: Deploy Prometheus Instance
```bash
kubectl apply -f prometheus/prometheus.yaml
```

### Step 4: Deploy ServiceMonitors
```bash
kubectl apply -f prometheus/service-monitors.yaml
```

### Step 5: Deploy Grafana
```bash
kubectl apply -f grafana/deployment.yaml
kubectl apply -f grafana/service.yaml
kubectl apply -f grafana/configmap.yaml
```

### Step 6: Deploy Jaeger
```bash
kubectl apply -f jaeger/deployment.yaml
kubectl apply -f jaeger/service.yaml
kubectl apply -f jaeger/configmap.yaml
```

### Step 7: Deploy Alertmanager
```bash
kubectl apply -f prometheus/alertmanager.yaml
```

### Step 8: Deploy Alerting Rules
```bash
kubectl apply -f prometheus/alerting-rules.yaml
```

### Step 9: Deploy Fluentd for CloudWatch
```bash
kubectl apply -f cloudwatch/fluentd-daemonset.yaml
```

## Verification

### Verify Prometheus Scraping
```bash
kubectl port-forward -n monitoring svc/prometheus 9090:9090
# Visit http://localhost:9090/targets
# All 5 services should show as "UP"
```

### Verify Grafana Dashboards
```bash
kubectl port-forward -n monitoring svc/grafana 3000:3000
# Visit http://localhost:3000
# Login with admin/admin
# Verify all 4 dashboards are loaded
```

### Verify Jaeger Tracing
```bash
kubectl port-forward -n monitoring svc/jaeger-query 16686:16686
# Visit http://localhost:16686
# Search for traces from "core-service"
# Verify trace spans across services
```

### Verify CloudWatch Logs
```bash
aws logs describe-log-groups --log-group-name-prefix /aws/eks/vatic-prop
aws logs tail /aws/eks/vatic-prop/core-service --follow
```

## Metrics

### Core Service Metrics
- `http_request_duration_seconds`: Request latency histogram
- `http_requests_total`: Total HTTP requests counter
- `kafka_messages_published_total`: Kafka messages published
- `kafka_publish_errors_total`: Kafka publish errors
- `saga_executions_total`: Saga execution counter
- `rule_checks_total`: Rule checks counter
- `assessment_state_updates_total`: Assessment state updates

### Market Data Service Metrics
- `http_request_duration_seconds`: Request latency
- `http_requests_total`: Total requests
- `market_data_circuit_breaker_state`: Circuit breaker state

### Monte Carlo Service Metrics
- `http_request_duration_seconds`: Request latency
- `http_requests_total`: Total requests
- `simulation_jobs_total`: Simulation job counter
- `simulation_duration_seconds`: Simulation duration
- `ray_serve_requests_total`: Ray Serve API calls
- `kafka_messages_consumed_total`: Kafka messages consumed

### WebSocket Service Metrics
- `http_request_duration_seconds`: Request latency
- `http_requests_total`: Total requests
- `websocket_connections_total`: Active connections gauge

### Report Service Metrics
- `http_request_duration_seconds`: Request latency
- `http_requests_total`: Total requests
- `reports_generated_total`: Reports generated counter
- `report_generation_duration_seconds`: Report generation duration
- `kafka_messages_consumed_total`: Kafka messages consumed

## Alert Rules

### HighP99Latency
- **Condition**: p99 latency > 10ms for 5 minutes
- **Severity**: Warning
- **Action**: Investigate service performance

### HighErrorRate
- **Condition**: Error rate > 1% for 5 minutes
- **Severity**: Critical
- **Action**: Page on-call engineer

### HighKafkaConsumerLag
- **Condition**: Consumer lag > 1000 messages for 5 minutes
- **Severity**: Warning
- **Action**: Check Kafka broker health

### ServiceDown
- **Condition**: Service health check fails for 1 minute
- **Severity**: Critical
- **Action**: Page on-call engineer

### HighMemoryUsage
- **Condition**: Memory usage > 85% for 5 minutes
- **Severity**: Warning
- **Action**: Scale up pod resources

## Correlation IDs

All services propagate correlation IDs across HTTP and Kafka boundaries:

1. **HTTP Requests**: Extract `X-Correlation-ID` header, generate UUID if missing
2. **Kafka Messages**: Include correlation ID in message headers
3. **Logs**: Include `correlation_id` field in all JSON log entries
4. **Traces**: Correlation ID is automatically propagated via OpenTelemetry

Example flow:
```
Client → Core Service (X-Correlation-ID: abc123)
Core Service → Kafka (correlation_id: abc123)
Kafka → Report Service (correlation_id: abc123)
Report Service → Logs (correlation_id: abc123)
```

## Common PromQL Queries

### Request Latency
```promql
# p99 latency by service
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# p95 latency by endpoint
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{route="/reports/:id"}[5m]))
```

### Error Rates
```promql
# Error rate by service
rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])

# 4xx errors by endpoint
rate(http_requests_total{status=~"4.."}[5m])
```

### Throughput
```promql
# Requests per second by service
rate(http_requests_total[1m])

# Kafka messages per second by topic
rate(kafka_messages_published_total[1m])
```

### Kafka Health
```promql
# Consumer lag by topic
kafka_consumer_lag

# Messages in queue
kafka_messages_in_queue
```

## Troubleshooting

### Prometheus Not Scraping Metrics
1. Check ServiceMonitor labels match Prometheus selector
2. Verify service has `prometheus.io/scrape: "true"` annotation
3. Check `/metrics` endpoint is accessible from Prometheus pod
4. Review Prometheus logs: `kubectl logs -n monitoring prometheus-0`

### Grafana Dashboards Not Loading
1. Verify Prometheus datasource is configured
2. Check dashboard JSON syntax
3. Verify PromQL queries are valid
4. Review Grafana logs: `kubectl logs -n monitoring deployment/grafana`

### Jaeger Not Receiving Traces
1. Verify Jaeger collector is running: `kubectl get pods -n monitoring`
2. Check service tracing configuration
3. Verify JAEGER_ENDPOINT environment variable is set
4. Review Jaeger logs: `kubectl logs -n monitoring deployment/jaeger`

### CloudWatch Logs Not Appearing
1. Verify Fluentd DaemonSet is running on all nodes
2. Check IAM role has CloudWatch Logs permissions
3. Verify log group exists: `aws logs describe-log-groups`
4. Review Fluentd logs: `kubectl logs -n monitoring daemonset/fluentd`

## Configuration

### Update Alert Thresholds
Edit `prometheus/alerting-rules.yaml` and update condition values:
```yaml
- alert: HighP99Latency
  expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 0.01  # Change 0.01 to desired threshold
```

### Update Notification Channels
Edit `prometheus/alertmanager.yaml` and add webhook URLs:
```yaml
slack_configs:
- api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
```

### Update Sampling Rate
Edit `jaeger/configmap.yaml` to change sampling percentage:
```json
"param": 0.1  # Change to 0.01 for 1% sampling
```

## Performance Tuning

### Prometheus
- Increase `--storage.tsdb.retention.size` for longer retention
- Adjust `scrape_interval` for more/less frequent scraping
- Increase PVC size for more metrics storage

### Grafana
- Increase dashboard refresh rate for real-time updates
- Add more panels for additional metrics
- Configure alert notifications

### Jaeger
- Increase `MEMORY_MAX_TRACES` for more trace storage
- Deploy Elasticsearch backend for production
- Configure trace sampling strategy per service

## References

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
