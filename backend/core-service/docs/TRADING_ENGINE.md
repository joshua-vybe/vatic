# Trading Engine Documentation

## Overview

The Trading Engine implements a robust order placement system with risk management, position tracking, and P&L calculations. It uses a Saga pattern to orchestrate complex multi-step operations with automatic rollback on failure.

## Architecture

### Components

1. **Trading Utilities** (`src/utils/trading.ts`)
   - Market price fetching from Redis
   - P&L calculations for crypto and prediction markets
   - Slippage and fee application
   - Market type detection

2. **Order Placement Saga** (`src/sagas/order-placement-saga.ts`)
   - Multi-step order execution with state management
   - Automatic rollback on failure
   - Risk validation and drawdown checking
   - Kafka event publishing

3. **Trading Routes** (`src/routes/trading.ts`)
   - REST API endpoints for order placement, position tracking, and trade history
   - Request validation and authentication
   - Response formatting with correlation IDs

4. **Persistence Worker** (`src/workers/persistence-worker.ts`)
   - Asynchronous persistence of Redis state to database
   - Position lifecycle management (creation, update, closure)
   - 5-second persistence interval

## Order Placement Saga Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Fetch Assessment State & Tier Rules                          │
│    - Verify assessment exists and is active                     │
│    - Load tier limits (maxRiskPerTrade, maxDrawdown)            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Fetch Current Market Price                                   │
│    - Read from Redis: market:{market}:price                     │
│    - Parse crypto (number) or prediction (JSON) format          │
│    - Return 503 if unavailable                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Validate Risk Per Trade                                      │
│    - Calculate position size with slippage/fees                 │
│    - Calculate risk = positionSize / currentBalance             │
│    - Reject if risk > maxRiskPerTrade                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Execute Order (Apply Slippage & Fees)                        │
│    - Calculate execution price with slippage                    │
│    - Calculate fee amount                                       │
│    - Create position object                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Update Balance & Positions in Redis                          │
│    - Deduct total cost from balance                             │
│    - Add position to positions array                            │
│    - Reject if balance goes negative                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. Update Peak Balance                                          │
│    - If newBalance > peakBalance, update peak                   │
│    - Idempotent operation                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. Check Drawdown Violation                                     │
│    - Calculate drawdown = (peakBalance - newBalance) / peakBalance
│    - If drawdown > maxDrawdown:                                 │
│      - Rollback Redis state                                     │
│      - Update assessment status to 'failed'                     │
│      - Publish rules.violation-detected event                   │
│      - Return success with status='failed'                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 8. Publish Kafka Events (Async)                                 │
│    - trading.order-placed                                       │
│    - trading.order-filled                                       │
│    - trading.position-opened                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    ✓ Order Placed Successfully
```

## P&L Calculations

### Crypto Markets

**Unrealized P&L:**
- Long: `(currentPrice - entryPrice) × quantity`
- Short: `(entryPrice - currentPrice) × quantity`

**Example:**
- Long 1 BTC at $50,000, current price $51,000
- P&L = ($51,000 - $50,000) × 1 = $1,000

### Prediction Markets

**Unrealized P&L (using current market price):**
- Yes side: `quantity × (currentPrice - entryPrice)`
- No side: `quantity × ((1 - currentPrice) - (1 - entryPrice))`

**Realized P&L (on event settlement):**
- Yes side: `outcome === 'yes' ? quantity × (1 - entryPrice) : -quantity × entryPrice`
- No side: `outcome === 'no' ? quantity × (1 - entryPrice) : -quantity × entryPrice`

**Example:**
- Buy 100 YES at 0.60 (cost: 60)
- Current market price: 0.70
- Unrealized P&L = 100 × (0.70 - 0.60) = 10
- If event resolves YES: Realized P&L = 100 × (1 - 0.60) = 40
- If event resolves NO: Realized P&L = -100 × 0.60 = -60

## Slippage & Fee Application

### Crypto Markets

```
executionPrice = marketPrice × (1 + slippage)
slippageAmount = (executionPrice - marketPrice) × quantity
feeAmount = executionPrice × quantity × fee
totalCost = executionPrice × quantity + feeAmount
```

**Default Configuration:**
- Slippage: 0.1% (0.001)
- Fee: 0.1% (0.001)

### Prediction Markets

Same calculation as crypto, but execution price is capped at 1.0:

```
executionPrice = min(marketPrice × (1 + slippage), 1.0)
```

**Default Configuration:**
- Slippage: 0.2% (0.002)
- Fee: 0.2% (0.002)

## Rollback Scenarios

### Scenario 1: Risk Validation Failure
- No state changes, no rollback needed
- Return 400 Bad Request immediately

### Scenario 2: Insufficient Balance
- Balance update failed before Redis commit
- No rollback needed
- Return 400 Bad Request

### Scenario 3: Drawdown Violation
- Redis state already updated
- Rollback: Restore previous balance and positions
- Update assessment status to 'failed'
- Publish violation event
- Return 200 OK with status='failed'

### Scenario 4: Saga Execution Error
- Attempt rollback if state was modified
- Log rollback action with correlation ID
- Return 500 Internal Server Error

## API Endpoints

### POST /api/orders

Place a new order.

**Request:**
```json
{
  "assessmentId": "uuid",
  "market": "BTC/USD" or "polymarket:market-id",
  "side": "long" | "short" | "yes" | "no",
  "quantity": 1.5
}
```

**Success Response (200 OK):**
```json
{
  "orderId": "uuid",
  "position": {
    "id": "uuid",
    "market": "BTC/USD",
    "side": "long",
    "quantity": 1.5,
    "entryPrice": 50050,
    "currentPrice": 50050,
    "unrealizedPnl": 0,
    "openedAt": "2024-01-14T10:30:00Z"
  },
  "balance": 49925,
  "correlationId": "uuid"
}
```

**Drawdown Violation Response (200 OK):**
```json
{
  "status": "failed",
  "reason": "drawdown_violation",
  "assessment": {
    "id": "uuid",
    "status": "failed"
  },
  "correlationId": "uuid"
}
```

**Error Response (400/503):**
```json
{
  "error": "Risk limit exceeded" | "Market data unavailable",
  "message": "Detailed error message",
  "correlationId": "uuid"
}
```

### GET /api/positions

Get open positions for an assessment.

**Query Parameters:**
- `assessmentId` (required): Assessment UUID

**Response (200 OK):**
```json
{
  "positions": [
    {
      "id": "uuid",
      "market": "BTC/USD",
      "side": "long",
      "quantity": 1.5,
      "entryPrice": 50050,
      "currentPrice": 51000,
      "unrealizedPnl": 1425,
      "openedAt": "2024-01-14T10:30:00Z"
    }
  ],
  "correlationId": "uuid"
}
```

### GET /api/trades

Get trade history for an assessment.

**Query Parameters:**
- `assessmentId` (required): Assessment UUID
- `limit` (optional, default 50, max 100): Number of trades to return
- `offset` (optional, default 0): Pagination offset

**Response (200 OK):**
```json
{
  "trades": [
    {
      "id": "uuid",
      "type": "open",
      "market": "BTC/USD",
      "side": "long",
      "quantity": 1.5,
      "price": 50050,
      "slippage": 75,
      "fee": 75.075,
      "pnl": 0,
      "timestamp": "2024-01-14T10:30:00Z"
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0,
  "correlationId": "uuid"
}
```

## Configuration

Environment variables for trading configuration:

```bash
# Crypto market slippage and fees (as decimals)
CRYPTO_SLIPPAGE_PERCENT=0.001      # 0.1%
CRYPTO_FEE_PERCENT=0.001           # 0.1%

# Prediction market slippage and fees (as decimals)
PREDICTION_SLIPPAGE_PERCENT=0.002  # 0.2%
PREDICTION_FEE_PERCENT=0.002       # 0.2%
```

## Kafka Events

### trading.order-placed
Published when order is validated and ready for execution.

```json
{
  "assessmentId": "uuid",
  "market": "BTC/USD",
  "side": "long",
  "quantity": 1.5,
  "executionPrice": 50050,
  "slippage": 75,
  "fee": 75.075,
  "correlationId": "uuid",
  "timestamp": "2024-01-14T10:30:00Z"
}
```

### trading.order-filled
Published when order is executed and balance is updated.

```json
{
  "assessmentId": "uuid",
  "market": "BTC/USD",
  "side": "long",
  "quantity": 1.5,
  "executionPrice": 50050,
  "totalCost": 75150.075,
  "correlationId": "uuid",
  "timestamp": "2024-01-14T10:30:00Z"
}
```

### trading.position-opened
Published when position is added to assessment state.

```json
{
  "assessmentId": "uuid",
  "positionId": "uuid",
  "market": "BTC/USD",
  "side": "long",
  "quantity": 1.5,
  "entryPrice": 50050,
  "correlationId": "uuid",
  "timestamp": "2024-01-14T10:30:00Z"
}
```

### rules.violation-detected
Published when drawdown violation is detected.

```json
{
  "assessmentId": "uuid",
  "type": "drawdown_violation",
  "drawdown": 0.25,
  "maxDrawdown": 0.2,
  "correlationId": "uuid",
  "timestamp": "2024-01-14T10:30:00Z"
}
```

## Redis State Structure

Assessment state stored in Redis with key `assessment:{id}:state`:

```json
{
  "assessmentId": "uuid",
  "currentBalance": 49925,
  "peakBalance": 50000,
  "realizedPnl": 0,
  "unrealizedPnl": 1425,
  "positions": [
    {
      "id": "uuid",
      "market": "BTC/USD",
      "side": "long",
      "quantity": 1.5,
      "entryPrice": 50050,
      "currentPrice": 51000,
      "unrealizedPnl": 1425,
      "openedAt": "2024-01-14T10:30:00Z"
    }
  ]
}
```

## Performance Targets

- Order placement latency: p99 < 10ms (Redis-only operations on critical path)
- Position fetch latency: p99 < 50ms (includes market price enrichment)
- Trade history fetch latency: p99 < 100ms (database query with pagination)

## Monitoring & Observability

### Key Metrics

- Order placement latency (p50, p95, p99)
- Order success/failure rates
- Saga rollback frequency
- Position count per assessment
- Trade volume by market type
- Drawdown violation frequency

### Logging

All operations include correlation IDs for distributed tracing:

```
[trading-routes] Order placement request received {
  correlationId: "uuid",
  assessmentId: "uuid",
  market: "BTC/USD",
  side: "long",
  quantity: 1.5
}
```

## Error Handling

### HTTP Status Codes

- `200 OK`: Order placed successfully or assessment failed due to drawdown
- `400 Bad Request`: Validation error (risk limit, insufficient balance, invalid request)
- `404 Not Found`: Assessment not found
- `503 Service Unavailable`: Market data unavailable
- `500 Internal Server Error`: Unexpected error during order processing

### Error Recovery

1. **Market Price Unavailable**: Return 503, client should retry
2. **Redis Failure**: Attempt rollback, return 500
3. **Database Failure**: Log error, return 500
4. **Saga Execution Error**: Automatic rollback, return 500

## Future Enhancements

1. **Position Closure**: Implement rules monitoring for position closure on assessment completion/failure
2. **Event Settlement**: Handle prediction market event settlement and realized P&L calculation
3. **Concurrent Orders**: Implement optimistic locking with version numbers if needed
4. **Price Staleness**: Add checks to reject prices older than 5 seconds
5. **Partial Fills**: Support partial order fills with multiple positions
6. **Stop Loss/Take Profit**: Implement automated position closure rules
