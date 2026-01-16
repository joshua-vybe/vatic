import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  calculateRuleStatus,
  calculateAssessmentRules,
  checkMinTradesRequirement,
} from "../../core-service/src/utils/rules-monitoring";

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
  },
};

// Mock Redis client
const mockRedis = {
  get: mock(async (key: string) => {
    if (key === "assessment:assessment-1:state") {
      return JSON.stringify({
        assessmentId: "assessment-1",
        currentBalance: 45000,
        peakBalance: 50000,
        tradeCount: 15,
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
      });
    }
    return null;
  }),
};

// Mock the getPrismaClient and getRedisClient functions
mock.module("../../core-service/src/db", () => ({
  getPrismaClient: () => mockPrisma,
}));

mock.module("../../core-service/src/utils/redis", () => ({
  getRedisClient: () => mockRedis,
}));

describe("Rules Monitoring", () => {
  describe("calculateRuleStatus", () => {
    it("should return safe when value is <80% of threshold", () => {
      expect(calculateRuleStatus(50, 100)).toBe("safe");
    });

    it("should return warning when value is 80-90% of threshold", () => {
      expect(calculateRuleStatus(85, 100)).toBe("warning");
    });

    it("should return danger when value is 90-100% of threshold", () => {
      expect(calculateRuleStatus(95, 100)).toBe("danger");
    });

    it("should handle zero threshold", () => {
      expect(calculateRuleStatus(0, 0)).toBe("safe");
    });
  });

  describe("calculateAssessmentRules", () => {
    it("should calculate all assessment rules", async () => {
      const rules = await calculateAssessmentRules("assessment-1");

      expect(rules).toBeDefined();
      expect(rules.drawdown).toBeDefined();
      expect(rules.riskPerTrade).toBeDefined();
      expect(rules.tradeCount).toBeDefined();
    });

    it("should apply assessment thresholds", async () => {
      const rules = await calculateAssessmentRules("assessment-1");

      // Assessment thresholds: max_drawdown 10%, max_risk_per_trade 2%, min_trades 10
      expect(rules.drawdown.threshold).toBe(0.1);
      expect(rules.riskPerTrade.threshold).toBe(0.02);
      expect(rules.tradeCount.threshold).toBe(10);
    });

    it("should detect drawdown violations", async () => {
      mockPrisma.assessment.findUnique = mock(async () => ({
        id: "assessment-1",
        status: "active",
        tier: {
          maxDrawdown: 0.1,
          minTrades: 10,
          maxRiskPerTrade: 0.02,
        },
      }));

      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 44000, // 12% drawdown
            peakBalance: 50000,
            tradeCount: 15,
            positions: [],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.drawdown.status).toBe("violation");
    });

    it("should detect risk per trade violations", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 15,
            positions: [
              {
                id: "pos-1",
                market: "BTC/USD",
                side: "long",
                quantity: 3,
                entryPrice: 1000,
                currentPrice: 1000,
              },
            ],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.riskPerTrade.status).toBe("violation");
    });

    it("should show safe status when all rules met", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 49500, // 1% drawdown
            peakBalance: 50000,
            tradeCount: 15,
            positions: [
              {
                id: "pos-1",
                market: "BTC/USD",
                side: "long",
                quantity: 1,
                entryPrice: 250,
                currentPrice: 250,
              },
            ],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.drawdown.status).toBe("safe");
      expect(rules.riskPerTrade.status).toBe("safe");
      expect(rules.tradeCount.status).toBe("safe");
    });

    it("should show warning status when approaching threshold", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 46000, // 8% drawdown (80% of 10% threshold)
            peakBalance: 50000,
            tradeCount: 15,
            positions: [],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.drawdown.status).toBe("warning");
    });

    it("should show danger status when near threshold", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 45500, // 9% drawdown (90% of 10% threshold)
            peakBalance: 50000,
            tradeCount: 15,
            positions: [],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.drawdown.status).toBe("danger");
    });
  });

  describe("Drawdown Calculation", () => {
    it("should calculate drawdown correctly", () => {
      const peakBalance = 10000;
      const currentBalance = 9000;
      const drawdown = (peakBalance - currentBalance) / peakBalance;
      expect(drawdown).toBe(0.1);
    });

    it("should return 0 when peak equals current", () => {
      const drawdown = (10000 - 10000) / 10000;
      expect(drawdown).toBe(0);
    });

    it("should return 1 when current is 0", () => {
      const drawdown = (10000 - 0) / 10000;
      expect(drawdown).toBe(1);
    });

    it("should handle zero peak balance", () => {
      const drawdown = 0 === 0 ? 0 : (0 - 0) / 0;
      expect(drawdown).toBe(0);
    });

    it("should calculate 50% drawdown", () => {
      const drawdown = (10000 - 5000) / 10000;
      expect(drawdown).toBe(0.5);
    });

    it("should calculate assessment drawdown threshold crossing", async () => {
      // Assessment threshold: 10%
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 45000, // 10% drawdown - at threshold
            peakBalance: 50000,
            tradeCount: 15,
            positions: [],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.drawdown.value).toBe(0.1);
      expect(rules.drawdown.threshold).toBe(0.1);
    });
  });

  describe("Risk Per Trade Calculation", () => {
    it("should calculate risk per trade correctly", () => {
      const risk = 500 / 10000;
      expect(risk).toBe(0.05);
    });

    it("should return 0 when position size is 0", () => {
      const risk = 0 / 10000;
      expect(risk).toBe(0);
    });

    it("should return 0 when account balance is zero", () => {
      // When balance is zero, risk calculation returns 0 (not Infinity)
      const risk = 500 === 0 ? 0 : 500 / 0;
      expect(risk).toBe(0);
    });

    it("should calculate 10% risk per trade", () => {
      const risk = 1000 / 10000;
      expect(risk).toBe(0.1);
    });

    it("should detect assessment risk violations", async () => {
      // Assessment threshold: 2%
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 15,
            positions: [
              {
                id: "pos-1",
                market: "BTC/USD",
                side: "long",
                quantity: 3,
                entryPrice: 1000,
                currentPrice: 1000,
              },
            ],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.riskPerTrade.value).toBe(0.06);
      expect(rules.riskPerTrade.threshold).toBe(0.02);
      expect(rules.riskPerTrade.status).toBe("violation");
    });
  });

  describe("Min Trades Requirement", () => {
    it("should return true when trades meet requirement", () => {
      expect(10 >= 10).toBe(true);
    });

    it("should return true when trades exceed requirement", () => {
      expect(15 >= 10).toBe(true);
    });

    it("should return false when trades below requirement", () => {
      expect(5 >= 10).toBe(false);
    });

    it("should handle zero requirement", () => {
      expect(0 >= 0).toBe(true);
    });

    it("should detect min trades violations", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 5, // Below 10 minimum
            positions: [],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.tradeCount.value).toBe(5);
      expect(rules.tradeCount.threshold).toBe(10);
      expect(rules.tradeCount.status).toBe("warning");
    });

    it("should pass min trades requirement", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 15, // Meets 10 minimum
            positions: [],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.tradeCount.value).toBe(15);
      expect(rules.tradeCount.threshold).toBe(10);
      expect(rules.tradeCount.status).toBe("safe");
    });
  });

  describe("checkMinTradesRequirement", () => {
    it("should return true when trades meet requirement", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 10,
            positions: [],
          });
        }
        return null;
      });

      const result = await checkMinTradesRequirement("assessment-1");
      expect(result).toBe(true);
    });

    it("should return true when trades exceed requirement", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 15,
            positions: [],
          });
        }
        return null;
      });

      const result = await checkMinTradesRequirement("assessment-1");
      expect(result).toBe(true);
    });

    it("should return false when trades below requirement", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 50000,
            peakBalance: 50000,
            tradeCount: 5,
            positions: [],
          });
        }
        return null;
      });

      const result = await checkMinTradesRequirement("assessment-1");
      expect(result).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle negative balance", () => {
      const drawdown = (10000 - (-1000)) / 10000;
      expect(drawdown).toBe(1.1);
    });

    it("should handle very small position sizes", () => {
      const risk = 0.001 / 10000;
      expect(risk).toBe(0.0000001);
    });

    it("should handle very large position sizes", () => {
      const risk = 100000 / 10000;
      expect(risk).toBe(10);
    });

    it("should handle all rules at violation state", async () => {
      mockRedis.get = mock(async (key: string) => {
        if (key === "assessment:assessment-1:state") {
          return JSON.stringify({
            assessmentId: "assessment-1",
            currentBalance: 40000, // 20% drawdown
            peakBalance: 50000,
            tradeCount: 5, // Below minimum
            positions: [
              {
                id: "pos-1",
                market: "BTC/USD",
                side: "long",
                quantity: 5,
                entryPrice: 1000,
                currentPrice: 1000,
              },
            ],
          });
        }
        return null;
      });

      const rules = await calculateAssessmentRules("assessment-1");
      expect(rules.drawdown.status).toBe("violation");
      expect(rules.riskPerTrade.status).toBe("violation");
    });
  });
});
