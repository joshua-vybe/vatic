import { describe, it, expect, beforeAll, afterAll } from "bun:test";

interface Position {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}

interface Assessment {
  id: string;
  status: "active" | "failed" | "passed";
  balance: number;
  peakBalance: number;
  positions: Position[];
}

interface Violation {
  id: string;
  assessmentId: string;
  ruleType: string;
  value: number;
  threshold: number;
  timestamp: Date;
}

class MockAssessmentService {
  private assessments: Map<string, Assessment> = new Map();

  async createAssessment(userId: string): Promise<Assessment> {
    const assessment: Assessment = {
      id: `assessment-${Date.now()}`,
      status: "active",
      balance: 50000,
      peakBalance: 50000,
      positions: [],
    };
    this.assessments.set(assessment.id, assessment);
    return assessment;
  }

  async getAssessment(assessmentId: string): Promise<Assessment | null> {
    return this.assessments.get(assessmentId) || null;
  }

  async updateAssessment(assessmentId: string, updates: Partial<Assessment>): Promise<void> {
    const assessment = this.assessments.get(assessmentId);
    if (assessment) {
      Object.assign(assessment, updates);
    }
  }

  clear(): void {
    this.assessments.clear();
  }
}

class MockTradingService {
  async placeOrder(
    assessmentId: string,
    symbol: string,
    side: string,
    quantity: number,
    price: number
  ): Promise<Position> {
    return {
      id: `pos-${Date.now()}`,
      symbol,
      side,
      quantity,
      entryPrice: price,
      currentPrice: price,
      pnl: 0,
    };
  }

  async closePosition(positionId: string, exitPrice: number): Promise<void> {
    // Position closed
  }

  async closeAllPositions(positions: Position[], currentPrices: Record<string, number>): Promise<void> {
    for (const position of positions) {
      const exitPrice = currentPrices[position.symbol] || position.currentPrice;
      await this.closePosition(position.id, exitPrice);
    }
  }
}

class MockRulesMonitoringService {
  async checkDrawdown(peakBalance: number, currentBalance: number, threshold: number): Promise<boolean> {
    const drawdown = (peakBalance - currentBalance) / peakBalance;
    return drawdown >= threshold;
  }

  async checkRiskPerTrade(positions: Position[], balance: number, threshold: number): Promise<boolean> {
    for (const position of positions) {
      const positionSize = position.quantity * position.entryPrice;
      const risk = positionSize / balance;
      if (risk >= threshold) {
        return true;
      }
    }
    return false;
  }
}

class MockViolationService {
  private violations: Map<string, Violation> = new Map();

  async recordViolation(
    assessmentId: string,
    ruleType: string,
    value: number,
    threshold: number
  ): Promise<Violation> {
    const violation: Violation = {
      id: `violation-${Date.now()}`,
      assessmentId,
      ruleType,
      value,
      threshold,
      timestamp: new Date(),
    };
    this.violations.set(violation.id, violation);
    return violation;
  }

  async getViolations(assessmentId: string): Promise<Violation[]> {
    return Array.from(this.violations.values()).filter((v) => v.assessmentId === assessmentId);
  }

  clear(): void {
    this.violations.clear();
  }
}

class MockNotificationService {
  private notifications: Array<{ assessmentId: string; type: string; message: string }> = [];

  async sendNotification(assessmentId: string, type: string, message: string): Promise<void> {
    this.notifications.push({ assessmentId, type, message });
  }

  getNotifications(assessmentId: string): Array<{ type: string; message: string }> {
    return this.notifications
      .filter((n) => n.assessmentId === assessmentId)
      .map((n) => ({ type: n.type, message: n.message }));
  }

  clear(): void {
    this.notifications = [];
  }
}

describe("Rules Violation Flow E2E", () => {
  let assessmentService: MockAssessmentService;
  let tradingService: MockTradingService;
  let rulesService: MockRulesMonitoringService;
  let violationService: MockViolationService;
  let notificationService: MockNotificationService;

  beforeAll(() => {
    assessmentService = new MockAssessmentService();
    tradingService = new MockTradingService();
    rulesService = new MockRulesMonitoringService();
    violationService = new MockViolationService();
    notificationService = new MockNotificationService();
  });

  afterAll(() => {
    assessmentService.clear();
    violationService.clear();
    notificationService.clear();
  });

  describe("Violation Detection", () => {
    it("should detect drawdown violation", async () => {
      const assessment = await assessmentService.createAssessment("user-1");

      // Place large losing position
      const position = await tradingService.placeOrder(assessment.id, "BTC/USD", "long", 10, 50000);
      assessment.positions.push(position);

      // Simulate large price drop (12% drawdown)
      const newBalance = 44000;
      const isViolation = await rulesService.checkDrawdown(assessment.peakBalance, newBalance, 0.1);

      expect(isViolation).toBe(true);
    });

    it("should detect risk per trade violation", async () => {
      const assessment = await assessmentService.createAssessment("user-2");

      // Place position with 15% risk (exceeds 10% limit)
      const position = await tradingService.placeOrder(assessment.id, "BTC/USD", "long", 3, 50000);
      assessment.positions.push(position);

      const isViolation = await rulesService.checkRiskPerTrade(assessment.positions, assessment.balance, 0.1);

      expect(isViolation).toBe(true);
    });

    it("should not flag safe positions", async () => {
      const assessment = await assessmentService.createAssessment("user-3");

      // Place small position (2% risk)
      const position = await tradingService.placeOrder(assessment.id, "BTC/USD", "long", 0.2, 50000);
      assessment.positions.push(position);

      const isViolation = await rulesService.checkRiskPerTrade(assessment.positions, assessment.balance, 0.1);

      expect(isViolation).toBe(false);
    });
  });

  describe("Violation Recording", () => {
    it("should record violation in database", async () => {
      const assessment = await assessmentService.createAssessment("user-4");

      const violation = await violationService.recordViolation(
        assessment.id,
        "max_drawdown",
        0.12,
        0.1
      );

      expect(violation.assessmentId).toBe(assessment.id);
      expect(violation.ruleType).toBe("max_drawdown");
      expect(violation.value).toBe(0.12);
    });

    it("should retrieve violations for assessment", async () => {
      const assessment = await assessmentService.createAssessment("user-5");

      await violationService.recordViolation(assessment.id, "max_drawdown", 0.12, 0.1);
      await violationService.recordViolation(assessment.id, "risk_per_trade", 0.15, 0.1);

      const violations = await violationService.getViolations(assessment.id);

      expect(violations.length).toBe(2);
      expect(violations[0].ruleType).toBe("max_drawdown");
      expect(violations[1].ruleType).toBe("risk_per_trade");
    });
  });

  describe("Position Auto-Close", () => {
    it("should close all positions on violation", async () => {
      const assessment = await assessmentService.createAssessment("user-6");

      // Place multiple positions
      const pos1 = await tradingService.placeOrder(assessment.id, "BTC/USD", "long", 1, 50000);
      const pos2 = await tradingService.placeOrder(assessment.id, "ETH/USD", "long", 10, 3000);
      assessment.positions.push(pos1, pos2);

      // Close all positions
      const currentPrices = { "BTC/USD": 44000, "ETH/USD": 2700 };
      await tradingService.closeAllPositions(assessment.positions, currentPrices);

      expect(assessment.positions.length).toBe(2);
    });

    it("should calculate P&L on position close", async () => {
      const assessment = await assessmentService.createAssessment("user-7");

      const position = await tradingService.placeOrder(assessment.id, "BTC/USD", "long", 1, 50000);
      assessment.positions.push(position);

      // Close at lower price
      const exitPrice = 44000;
      const pnl = (exitPrice - position.entryPrice) * position.quantity;

      expect(pnl).toBe(-6000);
    });
  });

  describe("Assessment Status Update", () => {
    it("should mark assessment as failed on violation", async () => {
      const assessment = await assessmentService.createAssessment("user-8");
      expect(assessment.status).toBe("active");

      // Trigger violation
      await assessmentService.updateAssessment(assessment.id, { status: "failed" });

      const updated = await assessmentService.getAssessment(assessment.id);
      expect(updated?.status).toBe("failed");
    });

    it("should prevent further trading after failure", async () => {
      const assessment = await assessmentService.createAssessment("user-9");
      await assessmentService.updateAssessment(assessment.id, { status: "failed" });

      const updated = await assessmentService.getAssessment(assessment.id);
      expect(updated?.status).toBe("failed");

      // Cannot place new orders when failed
      expect(updated?.status).not.toBe("active");
    });
  });

  describe("Notifications", () => {
    it("should send violation notification", async () => {
      const assessment = await assessmentService.createAssessment("user-10");

      await notificationService.sendNotification(
        assessment.id,
        "violation",
        "Maximum drawdown exceeded: 12% > 10%"
      );

      const notifications = notificationService.getNotifications(assessment.id);
      expect(notifications.length).toBe(1);
      expect(notifications[0].type).toBe("violation");
    });

    it("should send assessment failed notification", async () => {
      const assessment = await assessmentService.createAssessment("user-11");

      await notificationService.sendNotification(
        assessment.id,
        "assessment_failed",
        "Assessment failed due to rule violation"
      );

      const notifications = notificationService.getNotifications(assessment.id);
      expect(notifications.length).toBe(1);
      expect(notifications[0].type).toBe("assessment_failed");
    });
  });

  describe("Complete Violation Flow", () => {
    it("should complete full violation detection and handling flow", async () => {
      // Step 1: Create assessment
      const assessment = await assessmentService.createAssessment("user-12");
      expect(assessment.status).toBe("active");

      // Step 2: Place large position
      const position = await tradingService.placeOrder(assessment.id, "BTC/USD", "long", 10, 50000);
      assessment.positions.push(position);

      // Step 3: Detect drawdown violation
      const newBalance = 44000;
      const isViolation = await rulesService.checkDrawdown(assessment.peakBalance, newBalance, 0.1);
      expect(isViolation).toBe(true);

      // Step 4: Record violation
      const violation = await violationService.recordViolation(
        assessment.id,
        "max_drawdown",
        0.12,
        0.1
      );
      expect(violation.ruleType).toBe("max_drawdown");

      // Step 5: Close all positions
      const currentPrices = { "BTC/USD": 44000 };
      await tradingService.closeAllPositions(assessment.positions, currentPrices);

      // Step 6: Update assessment status
      await assessmentService.updateAssessment(assessment.id, {
        status: "failed",
        balance: newBalance,
      });

      // Step 7: Send notifications
      await notificationService.sendNotification(
        assessment.id,
        "violation",
        "Maximum drawdown exceeded"
      );
      await notificationService.sendNotification(
        assessment.id,
        "assessment_failed",
        "Assessment failed due to rule violation"
      );

      // Verify final state
      const finalAssessment = await assessmentService.getAssessment(assessment.id);
      const violations = await violationService.getViolations(assessment.id);
      const notifications = notificationService.getNotifications(assessment.id);

      expect(finalAssessment?.status).toBe("failed");
      expect(violations.length).toBe(1);
      expect(notifications.length).toBe(2);
    });
  });
});
