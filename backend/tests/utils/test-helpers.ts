import { describe, it, expect, beforeEach, afterEach } from "bun:test";

/**
 * Test setup and teardown utilities
 */

interface TestContext {
  db: any;
  redis: any;
  kafka: any;
  cleanup: () => Promise<void>;
}

export async function setupTestEnvironment(): Promise<TestContext> {
  // Initialize mock clients
  const db = {
    connect: async () => {},
    disconnect: async () => {},
    query: async (sql: string) => [],
  };

  const redis = {
    connect: async () => {},
    disconnect: async () => {},
    get: async (key: string) => null,
    set: async (key: string, value: any) => {},
    delete: async (key: string) => {},
  };

  const kafka = {
    connect: async () => {},
    disconnect: async () => {},
    produce: async (topic: string, message: any) => {},
    consume: async (topic: string) => [],
  };

  return {
    db,
    redis,
    kafka,
    cleanup: async () => {
      await db.disconnect();
      await redis.disconnect();
      await kafka.disconnect();
    },
  };
}

/**
 * Database seeding utilities
 */

export async function seedDatabase(db: any, data: any): Promise<void> {
  // Seed database with test data
  for (const [table, records] of Object.entries(data)) {
    for (const record of records as any[]) {
      await db.query(`INSERT INTO ${table} VALUES (...)`, record);
    }
  }
}

export async function clearDatabase(db: any, tables: string[]): Promise<void> {
  for (const table of tables) {
    await db.query(`TRUNCATE TABLE ${table}`);
  }
}

/**
 * Assertion helpers
 */

export function assertWithinRange(value: number, min: number, max: number, message?: string): void {
  if (value < min || value > max) {
    throw new Error(message || `Expected ${value} to be between ${min} and ${max}`);
  }
}

export function assertApproximately(actual: number, expected: number, tolerance: number, message?: string): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(message || `Expected ${actual} to be approximately ${expected} (±${tolerance})`);
  }
}

export function assertEventPublished(events: any[], eventType: string, data?: any): void {
  const found = events.find((e) => e.type === eventType && (!data || JSON.stringify(e.data) === JSON.stringify(data)));
  if (!found) {
    throw new Error(`Expected event ${eventType} to be published`);
  }
}

/**
 * Wait utilities
 */

export async function waitFor(
  condition: () => boolean,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error("Timeout waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export async function waitForEvent(
  events: any[],
  eventType: string,
  timeout: number = 5000
): Promise<any> {
  const startTime = Date.now();
  while (true) {
    const event = events.find((e) => e.type === eventType);
    if (event) {
      return event;
    }
    if (Date.now() - startTime > timeout) {
      throw new Error(`Timeout waiting for event ${eventType}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Mock data generators
 */

export function generateUser(overrides?: any) {
  return {
    id: `user-${Date.now()}`,
    email: `user${Math.random()}@example.com`,
    created_at: new Date(),
    ...overrides,
  };
}

export function generateAssessment(overrides?: any) {
  return {
    id: `assessment-${Date.now()}`,
    user_id: `user-${Date.now()}`,
    tier_id: "tier-1",
    status: "active",
    balance: 50000,
    peak_balance: 50000,
    starting_balance: 50000,
    created_at: new Date(),
    ...overrides,
  };
}

export function generateOrder(overrides?: any) {
  return {
    id: `order-${Date.now()}`,
    assessment_id: `assessment-${Date.now()}`,
    symbol: "BTC/USD",
    side: "long",
    size: 1,
    price: 50000,
    status: "filled",
    created_at: new Date(),
    ...overrides,
  };
}

export function generatePosition(overrides?: any) {
  return {
    id: `pos-${Date.now()}`,
    assessment_id: `assessment-${Date.now()}`,
    symbol: "BTC/USD",
    side: "long",
    entry_price: 50000,
    current_price: 50000,
    size: 1,
    pnl: 0,
    opened_at: new Date(),
    ...overrides,
  };
}

export function generateTrade(overrides?: any) {
  return {
    id: `trade-${Date.now()}`,
    assessment_id: `assessment-${Date.now()}`,
    symbol: "BTC/USD",
    side: "long",
    type: "MARKET",
    entry_price: 50000,
    size: 1,
    opened_at: new Date(),
    ...overrides,
  };
}

export function generateWithdrawal(overrides?: any) {
  return {
    id: `withdrawal-${Date.now()}`,
    funded_account_id: `account-${Date.now()}`,
    amount: 1000,
    status: "pending",
    requested_at: new Date(),
    ...overrides,
  };
}

/**
 * Comparison utilities
 */

export function compareObjects(obj1: any, obj2: any, ignoreFields: string[] = []): boolean {
  const keys1 = Object.keys(obj1).filter((k) => !ignoreFields.includes(k));
  const keys2 = Object.keys(obj2).filter((k) => !ignoreFields.includes(k));

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
      return false;
    }
  }

  return true;
}

export function getObjectDifferences(obj1: any, obj2: any): Record<string, any> {
  const differences: Record<string, any> = {};

  for (const key of Object.keys(obj1)) {
    if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
      differences[key] = {
        expected: obj1[key],
        actual: obj2[key],
      };
    }
  }

  return differences;
}

/**
 * Event Cancellation Test Helpers
 */

export function assertRefundCalculation(position: any, expectedRefund: number, tolerance: number = 0.01): void {
  const positionCost = position.entry_price * position.quantity;
  const feePercent = position.market?.startsWith("polymarket:") || position.market?.startsWith("kalshi:") ? 0.0005 : 0.001;
  const feeAmount = positionCost * feePercent;
  const actualRefund = positionCost + feeAmount;

  if (Math.abs(actualRefund - expectedRefund) > tolerance) {
    throw new Error(
      `Refund calculation mismatch. Expected: ${expectedRefund}, Actual: ${actualRefund}, Difference: ${Math.abs(actualRefund - expectedRefund)}`
    );
  }
}

export async function waitForPositionCancelled(
  redis: any,
  assessmentId: string,
  positionId: string,
  timeout: number = 5000
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const stateJson = await redis.get(`assessment:${assessmentId}:state`);
    if (stateJson) {
      const state = JSON.parse(stateJson);
      const position = state.positions?.find((p: any) => p.id === positionId);
      if (position?.status === 'cancelled') {
        return;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for position ${positionId} to be cancelled`);
}

export async function assertBalanceRestored(
  redis: any,
  assessmentId: string,
  expectedBalance: number,
  tolerance: number = 0.01
): Promise<void> {
  const stateJson = await redis.get(`assessment:${assessmentId}:state`);
  if (!stateJson) {
    throw new Error(`Assessment state not found for ${assessmentId}`);
  }

  const state = JSON.parse(stateJson);
  const actualBalance = state.currentBalance;

  if (Math.abs(actualBalance - expectedBalance) > tolerance) {
    throw new Error(
      `Balance mismatch. Expected: ${expectedBalance}, Actual: ${actualBalance}, Difference: ${Math.abs(actualBalance - expectedBalance)}`
    );
  }
}
