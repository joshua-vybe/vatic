# Persistence Worker Production-Grade Enhancements

## Overview
Enhanced the persistence worker with production-grade error handling, retry mechanisms, transaction atomicity, idempotency checks, and comprehensive observability metrics. These enhancements ensure cancelled positions are reliably persisted even during transient database failures, with proper monitoring and alerting capabilities.

## Implementation Details

### 1. Retry Utility with Exponential Backoff

**Location:** `backend/core-service/src/workers/persistence-worker.ts`

**Configuration:**
- `MAX_RETRIES = 3` - Maximum retry attempts
- `RETRY_DELAY_MS = 100` - Initial retry delay in milliseconds
- Exponential backoff: `delay = RETRY_DELAY_MS * Math.pow(2, attempt)`

**Function:** `retryDatabaseOperation<T>(fn, operationName, correlationId, maxRetries)`

**Features:**
- Automatic retry with exponential backoff for transient errors
- Error classification (transient vs permanent)
- Detailed logging for each retry attempt with correlation ID
- Throws last error after all retries exhausted

**Transient Errors (Retried):**
- Connection refused/timeout
- Host unreachable
- Connection reset
- Temporarily unavailable

**Permanent Errors (Not Retried):**
- UNIQUE constraint violations
- FOREIGN KEY constraint violations
- NOT NULL constraint violations
- Invalid input/syntax errors

### 2. Transaction-Based Atomicity

**Location:** `backend/core-service/src/workers/persistence-worker.ts` - `persistCancelledPosition()` function

**Implementation:**
```typescript
await prisma.$transaction(async (tx) => {
  // Update position status to 'cancelled'
  await tx.position.update({...});
  
  // Mark all associated trades as cancelled
  await tx.trade.updateMany({...});
  
  return { success: true };
});
```

**Guarantees:**
- All-or-nothing semantics: either all operations succeed or all rollback
- No partial updates to database
- Automatic rollback on any error within transaction
- Wrapped in `retryDatabaseOperation` for resilience

**Operations in Transaction:**
1. Update position status to 'cancelled'
2. Set closedAt timestamp
3. Mark all associated trades with `cancelled = true`

### 3. Idempotency Checks

**Location:** `backend/core-service/src/workers/persistence-worker.ts` - `persistCancelledPosition()` function

**Checks:**
1. **Position Status Check:**
   - Before updating, check if `dbPosition.status === 'cancelled'`
   - If already cancelled, skip update and log info message
   - Increment 'skipped' metric

2. **Trade Cancellation Check:**
   - Query count of uncancelled trades: `prisma.trade.count({ where: { positionId, cancelled: false } })`
   - Only execute `updateMany` if count > 0
   - Prevents redundant database operations

**Benefits:**
- Prevents duplicate processing of already-cancelled positions
- Reduces unnecessary database load
- Enables safe replay of failed operations
- Tracked via metrics for monitoring

### 4. Virtual Account Balance Update with Retry Logic

**Location:** `backend/core-service/src/workers/persistence-worker.ts` - `persistVirtualAccountBalance()` function

**Features:**
- Wrapped in `retryDatabaseOperation` for resilience
- Optimistic locking check: verify `updatedAt` hasn't changed
- Detects concurrent updates and logs warning
- Detailed logging of balance update attempts
- Metrics for success/failure tracking

**Optimistic Locking:**
```typescript
const currentVirtualAccount = await prisma.virtualAccount.findUnique({...});
if (currentVirtualAccount.updatedAt.getTime() !== virtualAccount.updatedAt.getTime()) {
  logger.warn('Concurrent update detected on virtual account, refetching', {...});
}
```

### 5. Specific Metrics for Cancelled Position Persistence

**Location:** `backend/core-service/src/utils/metrics.ts`

**New Metrics:**

1. **Counter: `cancelled_positions_persisted_total`**
   - Labels: `status` (success|failure|skipped)
   - Tracks total cancelled positions persisted to database
   - Incremented after each persistence attempt

2. **Counter: `cancelled_trades_marked_total`**
   - Labels: `status` (success|failure|skipped)
   - Tracks total trades marked as cancelled
   - Incremented after each trade marking operation

3. **Histogram: `cancelled_position_persistence_duration_seconds`**
   - Buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
   - Records duration of cancelled position persistence operations
   - Helps identify performance bottlenecks

4. **Gauge: `cancelled_positions_pending_persistence`**
   - Tracks number of cancelled positions in Redis but not yet persisted to database
   - Updated at end of each persistence cycle
   - Helps identify backlog

5. **Gauge: `cancelled_position_persistence_dlq_size`**
   - Tracks size of dead letter queue
   - Updated when operations are pushed to DLQ
   - Helps identify persistent failures

**Helper Functions:**
- `recordCancelledPositionPersisted(status)` - Increment counter
- `recordCancelledTradesMarked(status)` - Increment counter
- `recordCancelledPositionPersistenceDuration(duration)` - Record histogram
- `setCancelledPositionsPendingPersistence(count)` - Set gauge
- `setCancelledPositionPersistenceDlqSize(size)` - Set gauge

### 6. Dead Letter Queue Pattern for Failed Persistence

**Location:** `backend/core-service/src/workers/persistence-worker.ts` - `pushToDeadLetterQueue()` function

**Implementation:**
- Redis list key: `persistence:failed:cancelled-positions`
- Stores failed operation details as JSON

**DLQ Item Structure:**
```typescript
interface FailedOperation {
  assessmentId: string;
  positionId: string;
  timestamp: number;
  errorMessage: string;
  retryCount: number;
}
```

**Features:**
- Automatic TTL: 7 days (604,800 seconds)
- Prevents unbounded growth
- Pushed only on permanent errors or after max retries exhausted
- Logged with ERROR level and correlation ID
- Size tracked via `cancelled_position_persistence_dlq_size` metric

**Recovery:**
- Manual admin endpoint can be created to reprocess DLQ items
- Separate recovery worker can be implemented for automatic reprocessing
- DLQ items include full context for debugging

### 7. Comprehensive Error Handling and Logging

**Error Classification:**
```typescript
function classifyError(error: any): ErrorType {
  // Returns: 'transient' | 'permanent' | 'unknown'
}
```

**Error Handling Strategy:**
1. **Transient Errors:** Retry with exponential backoff
2. **Permanent Errors:** Log ERROR and push to DLQ without retry
3. **Unknown Errors:** Retry (conservative approach)

**Structured Logging:**
All error logs include:
- `correlationId` - For distributed tracing
- `assessmentId` - Assessment context
- `positionId` - Position context
- `operation` - Operation type
- `attempt` - Retry attempt number
- `errorType` - Classification (transient/permanent/unknown)
- `error` - Error message

**Error Codes:**
- Transient: Connection/timeout errors
- Permanent: Constraint/validation errors
- Unknown: Other errors (retried conservatively)

### 8. Health Check for Persistence Worker

**Location:** `backend/core-service/src/index.ts` - `/health/persistence` endpoint

**Endpoint:** `GET /health/persistence`

**Response:**
```json
{
  "status": "healthy|unhealthy",
  "lastSuccessTime": "2024-01-15T12:34:56.789Z",
  "consecutiveFailures": 0,
  "timeSinceLastSuccess": 1234
}
```

**Health Criteria:**
- Unhealthy if: `consecutiveFailures > 5` OR `timeSinceLastSuccess > 60000ms`
- Healthy otherwise

**Tracking:**
- `lastSuccessfulCycle` - Timestamp of last successful persistence cycle
- `consecutiveFailures` - Counter of consecutive failed cycles
- Updated after each persistence cycle

**Integration:**
- Can be used with Kubernetes liveness/readiness probes
- Enables automatic pod restart on persistent failures
- Provides visibility into worker health

## Data Flow

### Cancelled Position Persistence Flow

```
Persistence Worker (5-second interval)
    ↓
Scan Redis for assessment states
    ↓
For each assessment:
    ├─ Fetch virtual account
    ├─ Persist balance with retry logic
    └─ For each position:
        ├─ If new position: Create in database
        ├─ If existing position: Update price/PnL
        └─ If cancelled position:
            ├─ Check idempotency (already cancelled?)
            ├─ If not cancelled:
            │   ├─ Start retry loop (max 3 attempts)
            │   ├─ Begin transaction
            │   ├─ Update position status='cancelled'
            │   ├─ Mark trades as cancelled
            │   ├─ Commit transaction
            │   ├─ Record metrics (success)
            │   └─ Log success
            ├─ Else:
            │   ├─ Record metrics (skipped)
            │   └─ Log info
            └─ On failure:
                ├─ Classify error (transient/permanent)
                ├─ If transient: Retry with backoff
                ├─ If permanent: Push to DLQ
                ├─ Record metrics (failure)
                └─ Log error
    ↓
Update pending positions gauge
    ↓
Update health tracking
```

## Metrics and Monitoring

### Key Metrics to Monitor

1. **`cancelled_positions_persisted_total`**
   - Alert if success rate < 95%
   - Alert if failure rate > 5%

2. **`cancelled_position_persistence_duration_seconds`**
   - Alert if p99 latency > 1 second
   - Alert if p95 latency > 500ms

3. **`cancelled_positions_pending_persistence`**
   - Alert if > 100 pending positions
   - Alert if continuously increasing

4. **`cancelled_position_persistence_dlq_size`**
   - Alert if > 10 items in DLQ
   - Alert if DLQ size increasing

5. **Persistence Worker Health**
   - Alert if `/health/persistence` returns unhealthy
   - Alert if consecutive failures > 5

### Prometheus Queries

```promql
# Success rate
rate(cancelled_positions_persisted_total{status="success"}[5m]) / 
  rate(cancelled_positions_persisted_total[5m])

# Failure rate
rate(cancelled_positions_persisted_total{status="failure"}[5m]) / 
  rate(cancelled_positions_persisted_total[5m])

# P99 latency
histogram_quantile(0.99, cancelled_position_persistence_duration_seconds)

# Pending positions
cancelled_positions_pending_persistence

# DLQ size
cancelled_position_persistence_dlq_size
```

## Testing Considerations

### Unit Tests
- Mock database failures to verify retry logic
- Simulate transient vs permanent errors
- Verify transaction rollback on partial failures
- Test idempotency by processing same position multiple times
- Validate metrics are incremented correctly

### Integration Tests
- Test full cancelled position persistence flow
- Verify Redis state includes cancelled positions
- Verify database records reflect cancelled status
- Verify trades are marked as cancelled
- Verify account metrics remain consistent
- Test concurrent updates to same position

### Edge Cases
- Multiple positions cancelled in same cycle
- Mixed active and cancelled positions
- Cancelled position with zero unrealizedPnL
- Cancelled position with negative unrealizedPnL
- All positions cancelled (unrealizedPnL should be 0)
- Database connection timeout during transaction
- Partial transaction failure (rollback)
- Concurrent updates to virtual account

### Load Testing
- Test with 1000+ assessments
- Test with 10000+ positions
- Verify retry logic under high load
- Monitor memory usage during persistence cycles
- Verify metrics accuracy under load

## Deployment Considerations

### Configuration
- Retry parameters can be adjusted via constants
- Health check thresholds can be tuned
- DLQ TTL can be configured
- Persistence interval (5 seconds) can be adjusted

### Monitoring Setup
- Add Prometheus scrape config for `/metrics` endpoint
- Create Grafana dashboards for key metrics
- Set up alerts for unhealthy conditions
- Monitor DLQ for manual intervention

### Rollback Plan
- If issues arise, can disable retry logic by setting `MAX_RETRIES = 1`
- Can disable transaction wrapping by removing `prisma.$transaction`
- Can disable DLQ by commenting out `pushToDeadLetterQueue` call
- Health check endpoint can be disabled if causing issues

## Performance Impact

### Expected Overhead
- Retry logic: ~1-2% overhead for successful operations
- Transaction wrapping: ~5-10% overhead (atomic guarantees)
- Idempotency checks: ~2-3% overhead (additional queries)
- Metrics recording: <1% overhead

### Optimization Opportunities
- Batch cancelled position updates
- Use connection pooling for retries
- Cache idempotency check results
- Implement circuit breaker pattern

## Future Enhancements

1. **Automatic DLQ Recovery Worker**
   - Periodically reprocess DLQ items
   - Exponential backoff for repeated failures
   - Manual approval for sensitive operations

2. **Circuit Breaker Pattern**
   - Fail fast if database is consistently unavailable
   - Automatic recovery when database becomes available
   - Prevents cascading failures

3. **Batch Operations**
   - Batch multiple cancelled position updates
   - Reduce database round trips
   - Improve throughput

4. **Distributed Tracing**
   - Full trace context propagation
   - Correlation ID in all logs
   - Trace visualization in observability platform

5. **Adaptive Retry Strategy**
   - Adjust retry parameters based on error patterns
   - Machine learning for optimal retry timing
   - Dynamic backoff based on system load
