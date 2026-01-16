# Event-Driven Refund System Implementation

## Overview
Implemented an event-driven refund system that processes market event cancellations and automatically refunds affected positions. The system subscribes to the `events.event-cancelled` Kafka topic and handles refunds through a dedicated worker.

## Files Modified

### 1. backend/core-service/src/index.ts
**Changes:**
- Added import for event cancellation worker functions
- Updated Kafka consumer subscription to include both `assessment.completed` and `events.event-cancelled` topics
- Added conditional routing in `eachMessage` handler to process messages based on topic
- For `events.event-cancelled` messages:
  - Extracts `event_id`, `source`, and `status` from message payload
  - Calls `processEventCancellationEvent()` with correlation ID and trace context
  - Records consumer lag metrics for the new topic
- Added worker startup in service initialization (Step 5.11)
- Added worker shutdown in graceful shutdown sequence

**Key Implementation Details:**
- Maintains existing correlation ID extraction and trace context propagation patterns
- Follows established error handling and logging conventions
- Records consumer lag metrics for monitoring

### 2. backend/core-service/src/workers/event-cancellation-worker.ts (NEW FILE)
**Exports:**
- `startEventCancellationWorker()` - Lifecycle management (startup)
- `stopEventCancellationWorker()` - Lifecycle management (shutdown)
- `processEventCancellationEvent(eventId, source, status, correlationId, carrier)` - Main processing function

**Processing Logic:**

1. **Find Affected Positions**
   - Scans all assessment states in Redis using `redis.scan()` with pattern `assessment:*:state`
   - Iterates through each assessment to find positions

2. **Filter by Event**
   - Filters positions where `position.market` matches the cancelled event ID
   - Supports multiple market identifier formats:
     - Direct match: `eventId`
     - Polymarket format: `polymarket:${eventId}`
     - Kalshi format: `kalshi:${eventId}`

3. **Calculate Refunds**
   - Determines market type using `getMarketType(position.market)`
   - Retrieves slippage/fee config from environment (cryptoSlippage, cryptoFee, predictionSlippage, predictionFee)
   - Calculates refund amount:
     ```
     positionCost = entryPrice × quantity
     feeAmount = positionCost × feePercent
     refundAmount = positionCost + feeAmount
     ```

4. **Update Redis State**
   - Restores balance: `currentBalance += totalRefundAmount`
   - Removes cancelled positions from positions array
   - Updates state using `updateAssessmentState()`

5. **Publish Refund Events**
   - For each refunded position, publishes `trading.position-refunded` event with:
     - assessmentId, positionId, market, side, quantity, entryPrice
     - refundAmount, reason ('event_cancelled'), eventId, eventSource
     - correlationId for distributed tracing, timestamp

6. **Error Handling**
   - Wraps all operations in try-catch blocks
   - Logs errors with correlation IDs
   - Continues processing other positions/assessments on individual failures
   - Partial failures don't block overall processing

## Integration Points

### Upstream
- Market Data Service publishes `events.event-cancelled` when:
  - Polymarket or Kalshi events are cancelled or disputed
  - Event status changes to terminal state

### Downstream
- Persistence worker automatically detects cancelled positions in Redis state
- Updates Position records with `status = 'cancelled'` and `closedAt` timestamp
- Marks associated Trade records with `cancelled = true`
- Updates VirtualAccount balance in database
- No changes needed to persistence worker - works automatically

## Correlation ID & Distributed Tracing

- Extracts correlation ID from Kafka message headers
- Uses `runWithCorrelationId()` wrapper for context management
- Extracts trace context using OpenTelemetry propagation
- Executes processing within trace context
- Passes correlation ID to all downstream function calls
- Includes correlation ID in all log statements
- Injects correlation ID and trace context into published Kafka events

## Configuration

Uses existing trading configuration from `backend/core-service/src/config.ts`:
- `cryptoSlippage` - Slippage percentage for crypto markets
- `cryptoFee` - Fee percentage for crypto markets
- `predictionSlippage` - Slippage percentage for prediction markets
- `predictionFee` - Fee percentage for prediction markets

## Event Flow

```
Market Data Service
    ↓
Publishes events.event-cancelled
    ↓
Kafka Topic: events.event-cancelled
    ↓
Core Service Kafka Consumer
    ↓
Routes to Event Cancellation Worker
    ↓
Scans Redis for affected assessments
    ↓
Calculates refunds (entry cost + fees)
    ↓
Updates Redis state (restore balances, remove positions)
    ↓
Publishes trading.position-refunded events
    ↓
Persistence Worker (async)
    ↓
Reads updated Redis state
    ↓
Updates database:
  - Mark positions as cancelled
  - Mark trades as cancelled
  - Update virtual account balances
```

## Refund Calculation Details

### Crypto Markets
```
executionPrice = entryPrice (already includes slippage)
positionCost = executionPrice × quantity
feeAmount = positionCost × cryptoFee
refundAmount = positionCost + feeAmount
```

### Prediction Markets
```
executionPrice = entryPrice (already includes slippage, capped at 1.0)
positionCost = executionPrice × quantity
feeAmount = positionCost × predictionFee
refundAmount = positionCost + feeAmount
```

Note: The `entryPrice` stored in positions already reflects the execution price after slippage was applied during order placement.

## Redis State Updates

For each affected assessment:
- Add refund amount to `currentBalance`
- Remove cancelled positions from `positions` array
- Do NOT increment `tradeCount` - cancelled trades don't count toward minimum trade requirements
- Maintain `peakBalance` unchanged - cancellations don't affect historical peaks
- Set `unrealizedPnl` to 0 for cancelled positions before removal

## Error Handling & Resilience

- **Partial Failures**: Process each assessment independently; log errors but continue
- **Redis Unavailable**: Log warning and skip processing; Kafka will retry message
- **Invalid Event Data**: Validate event_id format; skip invalid events
- **No Affected Positions**: Log info message and return early (valid scenario)
- **State Update Failures**: Log error with correlation ID; Kafka consumer retries based on offset
- **Event Publishing Failures**: Log error but don't fail refund processing; events are best-effort

## Testing Considerations

- Test with multiple affected assessments
- Test with mixed market types (crypto and prediction)
- Test partial failure scenarios
- Verify correlation ID propagation through logs
- Verify Redis state updates
- Verify Kafka event publishing
- Test with no affected positions (should complete gracefully)
- Test with Redis unavailable (should log and skip)

## Monitoring & Observability

- Logs include correlation IDs for distributed tracing
- Consumer lag metrics recorded for `events.event-cancelled` topic
- Detailed logging at each processing step
- Error logging with full context
- Summary logging with affected assessment/position counts and total refund amounts
