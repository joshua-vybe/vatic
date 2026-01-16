# Verification Comments Round 2 - Detailed Changes

## Change 1: Add Shared Refund Calculation Helper

### File: `backend/core-service/src/utils/trading.ts`

**Added Function:**
```typescript
/**
 * Calculate cancellation refund for a position
 * Formula: (entryPrice × quantity) + fees
 * Cost recovery only, no profit/loss included
 */
export function calculateCancellationRefund(
  entryPrice: number,
  quantity: number,
  feePercent: number
): number {
  const positionCost = entryPrice * quantity;
  const feeAmount = positionCost * feePercent;
  return positionCost + feeAmount;
}
```

**Location:** End of file, after `getMarketType()` function

---

## Change 2: Update Event Cancellation Worker

### File: `backend/core-service/src/workers/event-cancellation-worker.ts`

**Import Change:**
```typescript
// OLD:
import { getMarketType } from '../utils/trading';

// NEW:
import { getMarketType, calculateCancellationRefund } from '../utils/trading';
```

**Refund Calculation Change:**
```typescript
// OLD:
for (const position of affectedPositionsInAssessment) {
  try {
    const marketType = getMarketType(position.market);
    const slippageConfig = {
      slippage: marketType === 'crypto' ? config.cryptoSlippage : config.predictionSlippage,
      fee: marketType === 'crypto' ? config.cryptoFee : config.predictionFee,
    };

    // Calculate original cost: (entryPrice × quantity) + fee
    const positionCost = position.entryPrice * position.quantity;
    const feeAmount = positionCost * slippageConfig.fee;
    const refundAmount = positionCost + feeAmount;

    assessmentRefundAmount += refundAmount;
    // ... rest of code ...
  }
}

// NEW:
for (const position of affectedPositionsInAssessment) {
  try {
    const marketType = getMarketType(position.market);
    const slippageConfig = {
      slippage: marketType === 'crypto' ? config.cryptoSlippage : config.predictionSlippage,
      fee: marketType === 'crypto' ? config.cryptoFee : config.predictionFee,
    };

    // Calculate refund using shared helper: (entryPrice × quantity) + fee
    const refundAmount = calculateCancellationRefund(
      position.entryPrice,
      position.quantity,
      slippageConfig.fee
    );

    assessmentRefundAmount += refundAmount;
    // ... rest of code ...
  }
}
```

---

## Change 3: Update Unit Tests

### File: `backend/tests/unit/event-cancellation.test.ts`

**Import Change:**
```typescript
// OLD:
import { describe, it, expect } from "bun:test";

// NEW:
import { describe, it, expect } from "bun:test";
import { calculateCancellationRefund } from "../../core-service/src/utils/trading";
```

**Removed Local Function:**
```typescript
// REMOVED:
/**
 * Calculate refund for a cancelled position
 * Formula: (entryPrice × quantity) + (entryPrice × quantity × feePercent)
 */
function calculateRefund(position: Position, feePercent: number): number {
  const positionCost = position.entryPrice * position.quantity;
  const feeAmount = positionCost * feePercent;
  return positionCost + feeAmount;
}

// REMOVED:
/**
 * Determine market type from market identifier
 */
function getMarketType(market: string): 'crypto' | 'prediction' {
  if (market.startsWith('polymarket:') || market.startsWith('kalshi:')) {
    return 'prediction';
  }
  return 'crypto';
}

/**
 * Get fee for market type
 */
function getFeeForMarket(market: string): number {
  const marketType = getMarketType(market);
  return marketType === 'crypto' ? 0.001 : 0.0005;
}
```

**Test Updates (Example):**
```typescript
// OLD:
it("should calculate refund as cost recovery for single crypto position", () => {
  const position: Position = {
    id: "pos-1",
    market: "BTC/USD",
    side: "long",
    quantity: 1,
    entryPrice: 50000,
    currentPrice: 50000,
    unrealizedPnl: 0,
    openedAt: new Date(),
    status: 'active',
  };

  const fee = 0.001;
  const expectedRefund = (50000 * 1) + (50000 * 1 * 0.001);
  const actualRefund = calculateRefund(position, fee);

  expect(actualRefund).toBe(expectedRefund);
  expect(actualRefund).toBe(50050);
});

// NEW:
it("should calculate refund as cost recovery for single crypto position", () => {
  const fee = 0.001;
  const expectedRefund = (50000 * 1) + (50000 * 1 * 0.001);
  const actualRefund = calculateCancellationRefund(50000, 1, fee);

  expect(actualRefund).toBe(expectedRefund);
  expect(actualRefund).toBe(50050);
});
```

**All test cases updated to use:**
```typescript
calculateCancellationRefund(entryPrice, quantity, fee)
```

---

## Change 4: Add Service Readiness Checks

### File: `backend/tests/integration/event-cancellation.test.ts`

**New Constants:**
```typescript
const CORE_SERVICE_URL = "http://localhost:3000";
```

**New Flag:**
```typescript
let servicesReady = false;
```

**New Interface:**
```typescript
interface RefundEvent {
  assessmentId: string;
  positionId: string;
  market: string;
  side: string;
  quantity: number;
  entryPrice: number;
  refundAmount: number;
  reason: string;
  eventId: string;
  eventSource: string;
  correlationId: string;
  timestamp: string;
}
```

**Updated beforeAll Hook:**
```typescript
// OLD:
beforeAll(async () => {
  const kafkaReady = await setupKafka();
  const redisReady = await setupRedis();

  if (!kafkaReady || !redisReady) {
    console.warn("⚠️  Test services not available...");
    return;
  }

  // Setup consumer...
});

// NEW:
beforeAll(async () => {
  const kafkaReady = await setupKafka();
  const redisReady = await setupRedis();
  const coreServiceReady = await waitForService(CORE_SERVICE_URL);

  if (!kafkaReady || !redisReady || !coreServiceReady) {
    console.warn("⚠️  Test services not available...");
    servicesReady = false;
    return;
  }

  servicesReady = true;

  // Setup consumer...
});
```

**Guard in Each Test:**
```typescript
it("should complete event cancellation flow for single position", async () => {
  if (!servicesReady) {
    console.warn("Services not ready, skipping test");
    return;
  }

  // ... rest of test ...
});
```

---

## Change 5: Add Refund Event Assertions

### File: `backend/tests/integration/event-cancellation.test.ts`

**New Event Capture:**
```typescript
let receivedRefundEvents: RefundEvent[] = [];

// In beforeAll:
await kafkaConsumerForTest.run({
  eachMessage: async ({ message }: { message: any }) => {
    if (message.value) {
      receivedRefundEvents.push(JSON.parse(message.value.toString()));
    }
  },
});
```

**Enhanced First Test:**
```typescript
it("should complete event cancellation flow for single position", async () => {
  // ... setup ...

  // Calculate expected refund
  const expectedRefund = (0.6 * 100) + (0.6 * 100 * 0.0005); // 60.03

  // ... publish event ...

  // Assert exact balance restoration
  expect(updatedState.currentBalance).toBeCloseTo(
    initialState.currentBalance + expectedRefund, 
    2
  );

  // Assert refund event was published
  await waitFor(
    () => receivedRefundEvents.some(
      (event: RefundEvent) => event.positionId === positionId && 
                              event.correlationId === correlationId
    ),
    5000
  );

  const refundEvent = receivedRefundEvents.find(
    (event: RefundEvent) => event.positionId === positionId && 
                            event.correlationId === correlationId
  );

  expect(refundEvent).toBeTruthy();
  expect(refundEvent?.refundAmount).toBeCloseTo(expectedRefund, 2);
  expect(refundEvent?.eventId).toBe(eventId);
  expect(refundEvent?.assessmentId).toBe(assessmentId);
});
```

---

## Summary of Changes

### Files Modified: 4
1. `backend/core-service/src/utils/trading.ts` - Added helper
2. `backend/core-service/src/workers/event-cancellation-worker.ts` - Use helper
3. `backend/tests/unit/event-cancellation.test.ts` - Use helper, remove local function
4. `backend/tests/integration/event-cancellation.test.ts` - Service checks, event assertions

### Lines Added: ~150
### Lines Removed: ~50
### Net Change: +100 lines

### Key Improvements
- ✅ Single source of truth for refund calculation
- ✅ Tests exercise production code
- ✅ Service readiness checks prevent timeouts
- ✅ Refund events verified end-to-end
- ✅ Exact balance restoration asserted
- ✅ Correlation ID propagation verified

### Backward Compatibility
- ✅ No breaking changes
- ✅ All existing code continues to work
- ✅ Only additions and improvements

