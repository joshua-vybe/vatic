# Trading Engine Verification Fixes

This document summarizes the implementation of five verification comments for the trading engine.

## Comment 1: Trading Routes Framework Mismatch ✅

**File**: `src/routes/trading.ts`

**Issue**: Trading routes were implemented using Express Router while the server uses Elysia, causing endpoints to not register.

**Fix**:
- Replaced Express `Router` implementation with Elysia route definitions
- Changed from `router.post()`, `router.get()` to Elysia `.post()`, `.get()` methods
- Integrated `createAuthMiddleware` using `.use(authMiddleware)`
- Returns an Elysia plugin that can be mounted with `.use()` in the main server

**Key Changes**:
```typescript
// Before: Express Router
export function createTradingRoutes(config: TradingConfig): Router {
  const router = Router();
  router.post('/orders', async (req: Request, res: Response) => { ... });
  return router;
}

// After: Elysia Plugin
export function createTradingRoutes(config: TradingConfig) {
  const authMiddleware = createAuthMiddleware(config.jwtSecret);
  return new Elysia()
    .use(authMiddleware)
    .post('/orders', async ({ body, userId }: { ... }) => { ... });
}
```

**Integration in `src/index.ts`**:
```typescript
.use(createTradingRoutes({
  jwtSecret: config.jwtSecret,
  cryptoSlippage: config.cryptoSlippage,
  cryptoFee: config.cryptoFee,
  predictionSlippage: config.predictionSlippage,
  predictionFee: config.predictionFee,
}))
```

## Comment 5: Missing Authentication & Ownership Checks ✅

**File**: `src/routes/trading.ts`

**Issue**: Trading endpoints lacked auth/ownership checks, allowing cross-user trading.

**Fix**:
- Applied `createAuthMiddleware` to all trading routes
- Added ownership verification for all endpoints:
  - Fetch assessment from database
  - Compare `assessment.userId` with authenticated `userId`
  - Return 403 Forbidden if user doesn't own the assessment
- Consistent error handling with proper HTTP status codes

**Implementation Details**:

### POST /orders
```typescript
// Verify user owns assessment
if (assessment.userId !== userId) {
  logger.warn('Unauthorized assessment access', { ... });
  return new Response(
    JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}
```

### GET /positions
```typescript
// Verify assessment exists and user owns it
if (assessment.userId !== userId) {
  logger.warn('Unauthorized assessment access', { ... });
  return new Response(
    JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}
```

### GET /trades
```typescript
// Verify assessment exists and user owns it
if (assessment.userId !== userId) {
  logger.warn('Unauthorized assessment access', { ... });
  return new Response(
    JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}
```

## Comment 2: Drawdown Calculation Unit Mismatch ✅

**Files**: 
- `src/utils/assessment-state.ts`
- `src/sagas/order-placement-saga.ts`

**Issue**: Drawdown calculation returned percentage (0-100) while tier limits were decimals (0-1), causing false violations.

**Fix**:

### In `assessment-state.ts`:
Changed `calculateDrawdown()` to return fractional value (0-1) instead of percentage:

```typescript
// Before: Returns 0-100
return ((peakBalance - currentBalance) / peakBalance) * 100;

// After: Returns 0-1
return (peakBalance - currentBalance) / peakBalance;
```

### In `order-placement-saga.ts`:
Updated logging and comparison to use consistent fractional units:

```typescript
logger.debug('Drawdown calculated', {
  correlationId,
  drawdown: `${(drawdown * 100).toFixed(2)}%`,
  maxDrawdown: `${(tierLimits.maxDrawdown * 100).toFixed(2)}%`,
});

if (drawdown > tierLimits.maxDrawdown) {
  // Now correctly compares 0-1 values
  logger.error('Drawdown violation detected', {
    drawdown: `${(drawdown * 100).toFixed(2)}%`,
    maxDrawdown: `${(tierLimits.maxDrawdown * 100).toFixed(2)}%`,
  });
}
```

**Result**: Drawdown violations now trigger correctly when fractional drawdown exceeds tier limit.

## Comment 3: Persistence Worker Schema Mismatch ✅

**Files**:
- `src/workers/persistence-worker.ts`
- `prisma/schema.prisma`

**Issue**: Persistence worker was writing `updatedAt` field to Position model which doesn't have that field, causing Prisma update errors.

**Fix**:
Removed `updatedAt` from the Position update call in persistence worker:

```typescript
// Before: Includes updatedAt
await prisma.position.update({
  where: { id: position.id },
  data: {
    currentPrice: position.currentPrice,
    unrealizedPnl: position.unrealizedPnl,
    updatedAt: new Date(),  // ❌ Field doesn't exist
  },
});

// After: Only updates existing fields
await prisma.position.update({
  where: { id: position.id },
  data: {
    currentPrice: position.currentPrice,
    unrealizedPnl: position.unrealizedPnl,
  },
});
```

**Note**: Position model in schema.prisma has no `updatedAt` field, only `openedAt` and `closedAt`.

## Comment 4: Trades Never Persisted ✅

**Files**:
- `src/sagas/order-placement-saga.ts`
- `src/routes/trading.ts`
- `src/workers/persistence-worker.ts`

**Issue**: Trades were never persisted on order placement, so GET /trades returned empty results.

**Fix**:
Added Trade persistence in the order placement saga (Step 9):

```typescript
// Step 9: Persist Trade to Database (Async)
// Create Trade record in database
prisma.trade
  .create({
    data: {
      assessmentId,
      positionId: newPosition.id,
      type: 'open',
      market,
      side,
      quantity,
      price: slippageResult.executionPrice,
      slippage: slippageResult.slippageAmount,
      fee: slippageResult.feeAmount,
      pnl: 0,
    },
  })
  .catch((error) => {
    logger.error('Failed to persist trade to database', {
      correlationId,
      assessmentId,
      positionId: newPosition.id,
      error: String(error),
    });
  });
```

**Key Details**:
- Trade creation is non-blocking (fire-and-forget with error logging)
- Doesn't delay order response to client
- Errors are logged but don't fail the order
- Trade type is 'open' for new positions
- PnL is 0 at order placement (realized only on closure)
- Slippage and fee amounts are captured from execution

**Result**: GET /trades now returns trades created during order placement.

## Testing Recommendations

### Comment 1 & 5: Auth & Ownership
- Test POST /orders with different user IDs - should return 403
- Test GET /positions with different user IDs - should return 403
- Test GET /trades with different user IDs - should return 403
- Verify auth middleware is properly applied

### Comment 2: Drawdown Calculation
- Test with tier maxDrawdown = 0.2 (20%)
- Place order that causes 15% drawdown - should succeed
- Place order that causes 25% drawdown - should fail with drawdown_violation
- Verify logging shows percentages correctly

### Comment 3: Persistence Worker
- Run persistence worker cycle
- Verify no Prisma errors on position updates
- Check that currentPrice and unrealizedPnl are updated correctly

### Comment 4: Trade Persistence
- Place an order via POST /orders
- Wait 5-10 seconds for persistence worker
- Call GET /trades - should return the trade
- Verify trade has correct market, side, quantity, price, slippage, fee

## Files Modified

1. `backend/core-service/src/routes/trading.ts` - Elysia implementation + auth checks
2. `backend/core-service/src/sagas/order-placement-saga.ts` - Drawdown units + trade persistence
3. `backend/core-service/src/utils/assessment-state.ts` - Drawdown calculation units
4. `backend/core-service/src/workers/persistence-worker.ts` - Remove updatedAt from position update
5. `backend/core-service/src/index.ts` - Already updated to use createTradingRoutes

## Summary

All five verification comments have been addressed:
- ✅ Trading routes now use Elysia framework
- ✅ Authentication and ownership checks implemented
- ✅ Drawdown calculation uses consistent fractional units
- ✅ Persistence worker no longer writes non-existent fields
- ✅ Trades are persisted on order placement
