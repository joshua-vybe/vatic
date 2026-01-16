import { describe, it, expect, beforeAll, afterAll } from "bun:test";

interface Trade {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
}

interface SimulationResult {
  assessmentId: string;
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  riskMetrics: Record<string, number>;
}

interface Report {
  assessmentId: string;
  summary: {
    trade_count: number;
    win_rate: number;
    pnl: number;
    drawdown: number;
  };
  rule_compliance: Record<string, boolean>;
}

class MockCoreService {
  private trades: Map<string, Trade[]> = new Map();

  async getTradeHistory(assessmentId: string): Promise<Trade[]> {
    return this.trades.get(assessmentId) || [];
  }

  addTrades(assessmentId: string, trades: Trade[]): void {
    this.trades.set(assessmentId, trades);
  }

  clear(): void {
    this.trades.clear();
  }
}

class MockRayServe {
  async runSimulation(trades: Trade[]): Promise<SimulationResult> {
    if (!trades || trades.length === 0) {
      throw new Error("No trades provided for simulation");
    }

    // Calculate metrics from trades
    const winningTrades = trades.filter((t) => t.pnl > 0);
    const losingTrades = trades.filter((t) => t.pnl < 0);
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

    return {
      assessmentId: "assessment-1",
      tradeCount: trades.length,
      winRate: winningTrades.length / trades.length,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      maxDrawdown: 0.1,
      sharpeRatio: 2.14,
      riskMetrics: {
        avgWin: grossProfit / Math.max(winningTrades.length, 1),
        avgLoss: grossLoss / Math.max(losingTrades.length, 1),
        riskRewardRatio: (grossProfit / Math.max(winningTrades.length, 1)) / (grossLoss / Math.max(losingTrades.length, 1)),
      },
    };
  }
}

class MockReportService {
  async generateReport(simulationResult: SimulationResult): Promise<Report> {
    return {
      assessmentId: simulationResult.assessmentId,
      summary: {
        trade_count: simulationResult.tradeCount,
        win_rate: simulationResult.winRate,
        pnl: simulationResult.tradeCount * 1000, // Mock PnL
        drawdown: simulationResult.maxDrawdown,
      },
      rule_compliance: {
        max_drawdown: simulationResult.maxDrawdown <= 0.1,
        min_trades: simulationResult.tradeCount >= 10,
        profit_target: simulationResult.tradeCount * 1000 >= 4000,
      },
    };
  }
}

class MockKafkaConsumer {
  private listeners: Map<string, (message: any) => void> = new Map();

  subscribe(topic: string, callback: (message: any) => void): void {
    this.listeners.set(topic, callback);
  }

  async publishMessage(topic: string, message: any): Promise<void> {
    const callback = this.listeners.get(topic);
    if (callback) {
      callback(message);
    }
  }
}

describe("Monte Carlo → Core → Report Integration", () => {
  let coreService: MockCoreService;
  let rayServe: MockRayServe;
  let reportService: MockReportService;
  let kafkaConsumer: MockKafkaConsumer;

  beforeAll(() => {
    coreService = new MockCoreService();
    rayServe = new MockRayServe();
    reportService = new MockReportService();
    kafkaConsumer = new MockKafkaConsumer();
  });

  afterAll(() => {
    coreService.clear();
  });

  describe("Assessment Completion Event", () => {
    it("should trigger on assessment completion", async () => {
      let eventReceived = false;

      kafkaConsumer.subscribe("assessment.completed", (message) => {
        eventReceived = true;
        expect(message.assessmentId).toBe("assessment-1");
      });

      await kafkaConsumer.publishMessage("assessment.completed", {
        assessmentId: "assessment-1",
        status: "passed",
        timestamp: new Date(),
      });

      expect(eventReceived).toBe(true);
    });
  });

  describe("Trade History Fetching", () => {
    it("should fetch trade history from Core Service", async () => {
      const trades: Trade[] = [
        {
          id: "trade-1",
          symbol: "BTC/USD",
          side: "long",
          entryPrice: 50000,
          exitPrice: 51000,
          quantity: 1,
          pnl: 1000,
        },
        {
          id: "trade-2",
          symbol: "ETH/USD",
          side: "long",
          entryPrice: 3000,
          exitPrice: 2900,
          quantity: 10,
          pnl: -1000,
        },
      ];

      coreService.addTrades("assessment-1", trades);
      const fetchedTrades = await coreService.getTradeHistory("assessment-1");

      expect(fetchedTrades.length).toBe(2);
      expect(fetchedTrades[0].pnl).toBe(1000);
      expect(fetchedTrades[1].pnl).toBe(-1000);
    });

    it("should handle empty trade history", async () => {
      const trades = await coreService.getTradeHistory("assessment-nonexistent");
      expect(trades.length).toBe(0);
    });

    it("should fetch multiple trades for analysis", async () => {
      const trades: Trade[] = Array.from({ length: 15 }, (_, i) => ({
        id: `trade-${i}`,
        symbol: i % 2 === 0 ? "BTC/USD" : "ETH/USD",
        side: "long",
        entryPrice: 50000,
        exitPrice: 50000 + (i % 3 === 0 ? 1000 : -500),
        quantity: 1,
        pnl: i % 3 === 0 ? 1000 : -500,
      }));

      coreService.addTrades("assessment-1", trades);
      const fetchedTrades = await coreService.getTradeHistory("assessment-1");

      expect(fetchedTrades.length).toBe(15);
    });
  });

  describe("Monte Carlo Simulation", () => {
    it("should run simulation on trade history", async () => {
      const trades: Trade[] = [
        {
          id: "trade-1",
          symbol: "BTC/USD",
          side: "long",
          entryPrice: 50000,
          exitPrice: 51000,
          quantity: 1,
          pnl: 1000,
        },
        {
          id: "trade-2",
          symbol: "BTC/USD",
          side: "long",
          entryPrice: 51000,
          exitPrice: 50500,
          quantity: 1,
          pnl: -500,
        },
      ];

      const result = await rayServe.runSimulation(trades);

      expect(result.tradeCount).toBe(2);
      expect(result.winRate).toBe(0.5);
      expect(result.profitFactor).toBeGreaterThan(0);
    });

    it("should calculate risk metrics", async () => {
      const trades: Trade[] = [
        { id: "1", symbol: "BTC/USD", side: "long", entryPrice: 50000, exitPrice: 51000, quantity: 1, pnl: 1000 },
        { id: "2", symbol: "BTC/USD", side: "long", entryPrice: 51000, exitPrice: 50500, quantity: 1, pnl: -500 },
        { id: "3", symbol: "BTC/USD", side: "long", entryPrice: 50500, exitPrice: 51500, quantity: 1, pnl: 1000 },
      ];

      const result = await rayServe.runSimulation(trades);

      expect(result.riskMetrics.avgWin).toBe(1000);
      expect(result.riskMetrics.avgLoss).toBe(500);
      expect(result.riskMetrics.riskRewardRatio).toBe(2);
    });

    it("should handle all winning trades", async () => {
      const trades: Trade[] = [
        { id: "1", symbol: "BTC/USD", side: "long", entryPrice: 50000, exitPrice: 51000, quantity: 1, pnl: 1000 },
        { id: "2", symbol: "BTC/USD", side: "long", entryPrice: 51000, exitPrice: 52000, quantity: 1, pnl: 1000 },
      ];

      const result = await rayServe.runSimulation(trades);

      expect(result.winRate).toBe(1);
      expect(result.profitFactor).toBe(Infinity);
    });

    it("should reject empty trade history", async () => {
      try {
        await rayServe.runSimulation([]);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(String(error)).toContain("No trades provided");
      }
    });
  });

  describe("Report Generation", () => {
    it("should generate report from simulation result", async () => {
      const simulationResult: SimulationResult = {
        assessmentId: "assessment-1",
        tradeCount: 15,
        winRate: 0.6,
        profitFactor: 2.5,
        maxDrawdown: 0.08,
        sharpeRatio: 2.14,
        riskMetrics: {},
      };

      const report = await reportService.generateReport(simulationResult);

      expect(report.assessmentId).toBe("assessment-1");
      expect(report.summary.trade_count).toBe(15);
      expect(report.summary.win_rate).toBe(0.6);
    });

    it("should verify rule compliance in report", async () => {
      const simulationResult: SimulationResult = {
        assessmentId: "assessment-1",
        tradeCount: 15,
        winRate: 0.6,
        profitFactor: 2.5,
        maxDrawdown: 0.08,
        sharpeRatio: 2.14,
        riskMetrics: {},
      };

      const report = await reportService.generateReport(simulationResult);

      expect(report.rule_compliance.max_drawdown).toBe(true);
      expect(report.rule_compliance.min_trades).toBe(true);
      expect(report.rule_compliance.profit_target).toBe(true);
    });
  });

  describe("Event Publishing", () => {
    it("should publish simulation-completed event", async () => {
      let eventReceived = false;
      let receivedData: any;

      kafkaConsumer.subscribe("montecarlo.simulation-completed", (message) => {
        eventReceived = true;
        receivedData = message;
      });

      await kafkaConsumer.publishMessage("montecarlo.simulation-completed", {
        assessmentId: "assessment-1",
        tradeCount: 15,
        winRate: 0.6,
        timestamp: new Date(),
      });

      expect(eventReceived).toBe(true);
      expect(receivedData.assessmentId).toBe("assessment-1");
    });

    it("should publish report-generated event", async () => {
      let eventReceived = false;

      kafkaConsumer.subscribe("report.generated", (message) => {
        eventReceived = true;
        expect(message.assessmentId).toBe("assessment-1");
      });

      await kafkaConsumer.publishMessage("report.generated", {
        assessmentId: "assessment-1",
        reportId: "report-1",
        timestamp: new Date(),
      });

      expect(eventReceived).toBe(true);
    });
  });

  describe("End-to-End Flow", () => {
    it("should complete full Monte Carlo → Report flow", async () => {
      // Step 1: Assessment completed
      let assessmentCompleted = false;
      kafkaConsumer.subscribe("assessment.completed", () => {
        assessmentCompleted = true;
      });

      await kafkaConsumer.publishMessage("assessment.completed", {
        assessmentId: "assessment-1",
        status: "passed",
      });

      expect(assessmentCompleted).toBe(true);

      // Step 2: Fetch trade history
      const trades: Trade[] = [
        { id: "1", symbol: "BTC/USD", side: "long", entryPrice: 50000, exitPrice: 51000, quantity: 1, pnl: 1000 },
        { id: "2", symbol: "BTC/USD", side: "long", entryPrice: 51000, exitPrice: 50500, quantity: 1, pnl: -500 },
      ];
      coreService.addTrades("assessment-1", trades);
      const fetchedTrades = await coreService.getTradeHistory("assessment-1");

      expect(fetchedTrades.length).toBe(2);

      // Step 3: Run simulation
      const simulationResult = await rayServe.runSimulation(fetchedTrades);
      expect(simulationResult.tradeCount).toBe(2);

      // Step 4: Generate report
      const report = await reportService.generateReport(simulationResult);
      expect(report.assessmentId).toBe("assessment-1");

      // Step 5: Publish report-generated event
      let reportGenerated = false;
      kafkaConsumer.subscribe("report.generated", () => {
        reportGenerated = true;
      });

      await kafkaConsumer.publishMessage("report.generated", {
        assessmentId: "assessment-1",
        reportId: "report-1",
      });

      expect(reportGenerated).toBe(true);
    });
  });
});
