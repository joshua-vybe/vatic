import { describe, it, expect, mock } from "bun:test";
import {
  calculateWithdrawableAmount,
  validateWithdrawalRequest,
} from "../../core-service/src/utils/withdrawal";

// Mock Prisma client
const mockPrisma = {
  fundedAccount: {
    findUnique: mock(async () => ({
      id: "funded-1",
      status: "active",
    })),
  },
};

// Mock getFundedAccountState
const mockGetFundedAccountState = mock(async () => ({
  fundedAccountId: "funded-1",
  currentBalance: 50000,
  positions: [],
}));

// Mock the dependencies
mock.module("../../core-service/src/db", () => ({
  getPrismaClient: () => mockPrisma,
}));

mock.module("../../core-service/src/utils/funded-account-state", () => ({
  getFundedAccountState: mockGetFundedAccountState,
}));

describe("Withdrawal Calculations", () => {
  describe("calculateWithdrawableAmount", () => {
    it("should calculate withdrawable amount with profit", () => {
      const withdrawable = calculateWithdrawableAmount(
        55000, // current balance
        50000, // starting balance
        0, // total withdrawals
        0.85 // profit split
      );
      expect(withdrawable).toBe(4250); // (55000 - 50000) * 0.85
    });

    it("should subtract previous withdrawals", () => {
      const withdrawable = calculateWithdrawableAmount(
        55000,
        50000,
        1000, // previous withdrawals
        0.85
      );
      expect(withdrawable).toBe(3250); // 4250 - 1000
    });

    it("should return 0 when no profit", () => {
      const withdrawable = calculateWithdrawableAmount(50000, 50000, 0, 0.85);
      expect(withdrawable).toBe(0);
    });

    it("should return 0 when balance below starting", () => {
      const withdrawable = calculateWithdrawableAmount(45000, 50000, 0, 0.85);
      expect(withdrawable).toBe(0);
    });

    it("should handle different profit splits", () => {
      const withdrawable90 = calculateWithdrawableAmount(55000, 50000, 0, 0.9);
      const withdrawable80 = calculateWithdrawableAmount(55000, 50000, 0, 0.8);
      expect(withdrawable90).toBe(4500);
      expect(withdrawable80).toBe(4000);
    });

    it("should handle zero profit split", () => {
      const withdrawable = calculateWithdrawableAmount(55000, 50000, 0, 0);
      expect(withdrawable).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero balance", () => {
      const withdrawable = calculateWithdrawableAmount(0, 50000, 0, 0.85);
      expect(withdrawable).toBe(0);
    });

    it("should handle very large profit", () => {
      const withdrawable = calculateWithdrawableAmount(150000, 50000, 0, 0.85);
      expect(withdrawable).toBe(85000);
    });

    it("should handle multiple withdrawals", () => {
      const withdrawable = calculateWithdrawableAmount(
        55000,
        50000,
        2000, // multiple previous withdrawals
        0.85
      );
      expect(withdrawable).toBe(2250);
    });

    it("should handle exact minimum withdrawal", () => {
      const withdrawable = calculateWithdrawableAmount(50100, 50000, 0, 0.85);
      expect(withdrawable).toBe(85);
    });
  });

  describe("validateWithdrawalRequest", () => {
    it("should validate successful withdrawal request", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        status: "active",
      }));

      mockGetFundedAccountState.mock = mock(async () => ({
        fundedAccountId: "funded-1",
        currentBalance: 50000,
        positions: [],
      }));

      const result = await validateWithdrawalRequest("funded-1", 500, 1000);
      expect(result.valid).toBe(true);
    });

    it("should reject withdrawal when account not active", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        status: "suspended",
      }));

      const result = await validateWithdrawalRequest("funded-1", 500, 1000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("suspended");
    });

    it("should reject withdrawal when account has open positions", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        status: "active",
      }));

      mockGetFundedAccountState.mock = mock(async () => ({
        fundedAccountId: "funded-1",
        currentBalance: 50000,
        positions: [
          {
            id: "pos-1",
            market: "BTC/USD",
            side: "long",
            quantity: 1,
            entryPrice: 50000,
            currentPrice: 50000,
          },
        ],
      }));

      const result = await validateWithdrawalRequest("funded-1", 500, 1000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("positions are open");
    });

    it("should reject withdrawal below minimum $100", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        status: "active",
      }));

      mockGetFundedAccountState.mock = mock(async () => ({
        fundedAccountId: "funded-1",
        currentBalance: 50000,
        positions: [],
      }));

      const result = await validateWithdrawalRequest("funded-1", 50, 1000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("$100");
    });

    it("should reject withdrawal exceeding withdrawable amount", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        status: "active",
      }));

      mockGetFundedAccountState.mock = mock(async () => ({
        fundedAccountId: "funded-1",
        currentBalance: 50000,
        positions: [],
      }));

      const result = await validateWithdrawalRequest("funded-1", 2000, 1000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds available balance");
    });

    it("should accept withdrawal at minimum $100", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        status: "active",
      }));

      mockGetFundedAccountState.mock = mock(async () => ({
        fundedAccountId: "funded-1",
        currentBalance: 50000,
        positions: [],
      }));

      const result = await validateWithdrawalRequest("funded-1", 100, 1000);
      expect(result.valid).toBe(true);
    });

    it("should accept withdrawal at exact withdrawable amount", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        status: "active",
      }));

      mockGetFundedAccountState.mock = mock(async () => ({
        fundedAccountId: "funded-1",
        currentBalance: 50000,
        positions: [],
      }));

      const result = await validateWithdrawalRequest("funded-1", 1000, 1000);
      expect(result.valid).toBe(true);
    });

    it("should reject withdrawal when account closed", async () => {
      mockPrisma.fundedAccount.findUnique = mock(async () => ({
        id: "funded-1",
        status: "closed",
      }));

      const result = await validateWithdrawalRequest("funded-1", 500, 1000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("closed");
    });
  });
});
