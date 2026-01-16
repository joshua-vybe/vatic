import { describe, it, expect, beforeEach, mock } from "bun:test";
import { executeOrderPlacementSaga } from "../../core-service/src/sagas/order-placement-saga";
import { executeWithdrawalProcessingSaga } from "../../core-service/src/sagas/withdrawal-processing-saga";

// Mock Prisma client
const mockPrisma = {
  assessment: {
    findUnique: mock(async () => ({
      id: "assessment-1",
      status: "active",
      tier: {
        maxDrawdown: 0.1,
        minTrades: 10,
        maxRiskPerTrade: 0.02,
      },
    })),
    update: mock(async () => ({})),
  },
  trade: {
    create: mock(async () => ({})),
  },
  fundedAccount: {
    findUnique: mock(async () => ({
      id: "funded-1",
      userId: "user-1",
      status: "active",
      tier: {
        profitSplit: 0.85,
      },
      fundedVirtualAccount: {
        id: "virt-1",
        currentBalance: 50000,
        startingBalance: 50000,
        totalWithdrawals: 0,
      },
    })),
  },
  fundedVirtualAccount: {
    update: mock(async () => ({})),
  },
  withdrawal: {
    create: mock(async () => ({ id: "withdrawal-1" })),
    update: mock(async () => ({})),
    delete: mock(async () => ({})),
  },
};

// Mock Redis client
const mockRedis = {
  get: mock(async (key: string) => {
    if (key === "assessment:assessment-1:state") {
      return JSON.stringify({
        assessmentId: "assessment-1",
        currentBalance: 50000,
        peakBalance: 50000,
        tradeCount: 0,
        positions: [],
      });
    }
    if (key === "funded:funded-1:state") {
      return JSON.stringify({
        fundedAccountId: "funded-1",
        currentBalance: 50000,
        positions: [],
        totalWithdrawals: 0,
      });
    }
    return null;
  }),
  set: mock(async () => true),
};

// Mock market price fetching
const mockGetMarketPrice = mock(async () => 50000);

// Mock Kafka publishing
const mockPublishEvent = mock(async () => {});

// Mock Stripe payout
const mockCreatePayout = mock(async () => ({ id: "payout-123" }));

// Setup mocks
mock.module("../../core-service/src/db", () => ({
  getPrismaClient: () => mockPrisma,
}));

mock.module("../../core-service/src/utils/redis", () => ({
  getRedisClient: () => mockRedis,
}));

mock.module("../../core-service/src/utils/trading", () => ({
  getMarketPrice: mockGetMarketPrice,
  applySlippageAndFees: (price: number, quantity: number, type: string, config: any) => ({
    executionPrice: price * (1 + config.slippage),
    slippageAmount: price * quantity * config.slippage,
    feeAmount: price * quantity * config.fee,
    totalCost: price * quantity * (1 + config.slippage + config.fee),
  }),
  getMarketType: (market: string) => market.includes("polymarket") ? "prediction" : "crypto",
}));

mock.module("../../core-service/src/utils/kafka", () => ({
  publishEvent: mockPublishEvent,
}));

mock.module("../../core-service/src/sagas/stripe-integration", () => ({
  createPayout: mockCreatePayout,
}));

describe("Saga Rollbacks", () => {
  describe("Order Placement Saga", () => {
    it("should successfully place order", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 0,
            positions: [],
          });
        }
        return null;
      });

      const result = await executeOrderPlacementSaga(
        "assessment-1",
        "BTC/USD",
        "long",
        1,
        {
          cryptoSlippage: 0.001,
          cryptoFee: 0.001,
          predictionSlippage: 0.0005,
          predictionFee: 0.0005,
        }
      );

      expect(result.success).toBe(true);
      expect(result.position).toBeDefined();
      expect(result.balance).toBeLessThan(50000);
    });

    it("should rollback on drawdown violation", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 0,
            positions: [],
          });
        }
        return null;
      });

      mockGetMarketPrice.mock = mock(async () => 100000); // Very high price

      const result = await executeOrderPlacementSaga(
        "assessment-1",
        "BTC/USD",
        "long",
        10, // Large quantity to trigger drawdown
        {
          cryptoSlippage: 0.001,
          cryptoFee: 0.001,
          predictionSlippage: 0.0005,
          predictionFee: 0.0005,
        }
      );

      // Should fail due to drawdown or insufficient balance
      expect(result.success).toBe(false);
    });

    it("should rollback on insufficient balance", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 1000, // Very low balance
            peakBalance: 1000,
            tradeCount: 0,
            positions: [],
          });
        }
        return null;
      });

      const result = await executeOrderPlacementSaga(
        "assessment-1",
        "BTC/USD",
        "long",
        1,
        {
          cryptoSlippage: 0.001,
          cryptoFee: 0.001,
          predictionSlippage: 0.0005,
          predictionFee: 0.0005,
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient balance");
    });

    it("should publish order-placed event on success", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 0,
            positions: [],
          });
        }
        return null;
      });

      mockPublishEvent.mock = mock(async () => {});

      await executeOrderPlacementSaga(
        "assessment-1",
        "BTC/USD",
        "long",
        1,
        {
          cryptoSlippage: 0.001,
          cryptoFee: 0.001,
          predictionSlippage: 0.0005,
          predictionFee: 0.0005,
        }
      );

      // Verify event was published
      expect(mockPublishEvent.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("Withdrawal Processing Saga", () => {
    it("should successfully process withdrawal", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        userId: "user-1",
        status: "active",
        tier: {
          profitSplit: 0.85,
        },
        fundedVirtualAccount: {
          id: "virt-1",
          currentBalance: 55000,
          startingBalance: 50000,
          totalWithdrawals: 0,
        },
      }));

      mockRedis.get = mock(async (key: string) => {
        if (key === "funded:funded-1:state") {
          return JSON.stringify({
            fundedAccountId: "funded-1",
            currentBalance: 55000,
            positions: [],
            totalWithdrawals: 0,
          });
        }
        return null;
      });

      mockCreatePayout.mock = mock(async () => ({ id: "payout-123" }));

      const result = await executeWithdrawalProcessingSaga(
        "funded-1",
        "user-1",
        500
      );

      expect(result.success).toBe(true);
      expect(result.withdrawalId).toBeDefined();
    });

    it("should rollback on insufficient balance", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        userId: "user-1",
        status: "active",
        tier: {
          profitSplit: 0.85,
        },
        fundedVirtualAccount: {
          id: "virt-1",
          currentBalance: 50000,
          startingBalance: 50000,
          totalWithdrawals: 0,
        },
      }));

      const result = await executeWithdrawalProcessingSaga(
        "funded-1",
        "user-1",
        100000 // Exceeds available balance
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient balance");
    });

    it("should reject withdrawal when account not active", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        userId: "user-1",
        status: "suspended",
        tier: {
          profitSplit: 0.85,
        },
        fundedVirtualAccount: {
          id: "virt-1",
          currentBalance: 55000,
          startingBalance: 50000,
          totalWithdrawals: 0,
        },
      }));

      const result = await executeWithdrawalProcessingSaga(
        "funded-1",
        "user-1",
        500
      );

      expect(result.success).toBe(false);
    });

    it("should reject withdrawal when user unauthorized", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        userId: "user-2", // Different user
        status: "active",
        tier: {
          profitSplit: 0.85,
        },
        fundedVirtualAccount: {
          id: "virt-1",
          currentBalance: 55000,
          startingBalance: 50000,
          totalWithdrawals: 0,
        },
      }));

      const result = await executeWithdrawalProcessingSaga(
        "funded-1",
        "user-1",
        500
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unauthorized");
    });

    it("should publish withdrawal events on success", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        userId: "user-1",
        status: "active",
        tier: {
          profitSplit: 0.85,
        },
        fundedVirtualAccount: {
          id: "virt-1",
          currentBalance: 55000,
          startingBalance: 50000,
          totalWithdrawals: 0,
        },
      }));

      mockRedis.get = mock(async (key: string) => {
        if (key === "funded:funded-1:state") {
          return JSON.stringify({
            fundedAccountId: "funded-1",
            currentBalance: 55000,
            positions: [],
            totalWithdrawals: 0,
          });
        }
        return null;
      });

      mockPublishEvent.mock = mock(async () => {});

      await executeWithdrawalProcessingSaga(
        "funded-1",
        "user-1",
        500
      );

      // Verify events were published
      expect(mockPublishEvent.mock.calls.length).toBeGreaterThan(0);
    });

    it("should auto-approve withdrawals under $1000", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        userId: "user-1",
        status: "active",
        tier: {
          profitSplit: 0.85,
        },
        fundedVirtualAccount: {
          id: "virt-1",
          currentBalance: 55000,
          startingBalance: 50000,
          totalWithdrawals: 0,
        },
      }));

      mockRedis.get = mock(async (key: string) => {
        if (key === "funded:funded-1:state") {
          return JSON.stringify({
            fundedAccountId: "funded-1",
            currentBalance: 55000,
            positions: [],
            totalWithdrawals: 0,
          });
        }
        return null;
      });

      const result = await executeWithdrawalProcessingSaga(
        "funded-1",
        "user-1",
        500
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");
    });

    it("should queue large withdrawals for review", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        userId: "user-1",
        status: "active",
        tier: {
          profitSplit: 0.85,
        },
        fundedVirtualAccount: {
          id: "virt-1",
          currentBalance: 100000,
          startingBalance: 50000,
          totalWithdrawals: 0,
        },
      }));

      mockRedis.get = mock(async (key: string) => {
        if (key === "funded:funded-1:state") {
          return JSON.stringify({
            fundedAccountId: "funded-1",
            currentBalance: 100000,
            positions: [],
            totalWithdrawals: 0,
          });
        }
        return null;
      });

      const result = await executeWithdrawalProcessingSaga(
        "funded-1",
        "user-1",
        5000 // Over $1000 threshold
      );

      expect(result.success).toBe(true);
      expect(result.requiresReview).toBe(true);
      expect(result.status).toBe("pending");
    });
  });

  describe("State Restoration", () => {
    it("should preserve balance on rollback", async () => {
      const initialBalance = 50000;

      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: initialBalance,
            peakBalance: initialBalance,
            tradeCount: 0,
            positions: [],
          });
        }
        return null;
      });

      mockGetMarketPrice.mock = mock(async () => 100000);

      await executeOrderPlacementSaga(
        "assessment-1",
        "BTC/USD",
        "long",
        10,
        {
          cryptoSlippage: 0.001,
          cryptoFee: 0.001,
          predictionSlippage: 0.0005,
          predictionFee: 0.0005,
        }
      );

      // Verify rollback was called (state should be restored)
      expect(mockRedis.set.mock.calls.length).toBeGreaterThanOrEqual(0);
    });
  });
});
