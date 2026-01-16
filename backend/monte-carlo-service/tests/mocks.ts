/**
 * Mock utilities for testing Monte Carlo Service
 * Provides test doubles for external dependencies
 */

import { SimulationInput, SimulationResult } from "../src/clients/ray-serve";
import {
  AssessmentData,
  TradeHistoryItem,
  FundedAccountData,
} from "../src/clients/core-service";

/**
 * Mock Ray Serve client for testing
 */
export const mockRayServeClient = {
  callRayServeSimulation: async (
    input: SimulationInput
  ): Promise<SimulationResult> => {
    return {
      riskMetrics: {
        valueAtRisk95: 5000.0,
        valueAtRisk99: 7500.0,
        expectedShortfall: 8000.0,
        maxDrawdown: 0.15,
        sharpeRatio: 1.5,
        sortinoRatio: 2.1,
      },
      confidenceIntervals: {
        return95Lower: -0.05,
        return95Upper: 0.15,
        return99Lower: -0.1,
        return99Upper: 0.2,
      },
      variance: 0.0025,
      pathsSimulated: 1000000,
      simulationTimeSeconds: 45.2,
      tradesAnalyzed: input.tradeHistory.length,
      currentBalance: input.pnlData.balance,
      peakBalance: input.pnlData.peak,
    };
  },

  healthCheckRayServe: async (): Promise<boolean> => {
    return true;
  },
};

/**
 * Mock Core Service client for testing
 */
export const mockCoreServiceClient = {
  fetchAssessmentData: async (
    assessmentId: string
  ): Promise<AssessmentData> => {
    return {
      id: assessmentId,
      userId: "user-123",
      tierId: "tier-1",
      status: "passed",
      virtualAccount: {
        balance: 100000,
        peak: 105000,
        pnl: 5000,
      },
    };
  },

  fetchTradeHistory: async (
    assessmentId: string
  ): Promise<TradeHistoryItem[]> => {
    return [
      {
        id: "trade-1",
        market: "BTC",
        side: "buy",
        quantity: 1,
        price: 50000,
        pnl: 1000,
        timestamp: new Date().toISOString(),
      },
      {
        id: "trade-2",
        market: "ETH",
        side: "sell",
        quantity: 10,
        price: 3000,
        pnl: 500,
        timestamp: new Date().toISOString(),
      },
    ];
  },

  fetchFundedAccountData: async (
    fundedAccountId: string
  ): Promise<FundedAccountData> => {
    return {
      id: fundedAccountId,
      userId: "user-456",
      status: "active",
      virtualAccount: {
        balance: 250000,
        peak: 260000,
        pnl: 10000,
      },
    };
  },

  fetchTradeHistoryForFundedAccount: async (
    fundedAccountId: string
  ): Promise<TradeHistoryItem[]> => {
    return [
      {
        id: "trade-3",
        market: "BTC",
        side: "buy",
        quantity: 2,
        price: 50000,
        pnl: 2000,
        timestamp: new Date().toISOString(),
      },
      {
        id: "trade-4",
        market: "SOL",
        side: "buy",
        quantity: 100,
        price: 150,
        pnl: 1500,
        timestamp: new Date().toISOString(),
      },
      {
        id: "trade-5",
        market: "ETH",
        side: "sell",
        quantity: 20,
        price: 3000,
        pnl: 1000,
        timestamp: new Date().toISOString(),
      },
    ];
  },
};

/**
 * Mock Kafka producer for testing
 */
export const mockKafkaProducer = {
  publishEvent: async (
    topic: string,
    message: Record<string, any>
  ): Promise<boolean> => {
    console.log(`[MOCK] Published to ${topic}:`, message);
    return true;
  },

  disconnectKafka: async (): Promise<void> => {
    console.log("[MOCK] Kafka producer disconnected");
  },
};

/**
 * Mock Redis client for testing
 */
export const mockRedisClient = {
  initializeRedis: async (): Promise<any> => {
    return {
      ping: async () => "PONG",
      disconnect: async () => {},
    };
  },

  pingRedis: async (): Promise<boolean> => {
    return true;
  },

  disconnectRedis: async (): Promise<void> => {
    console.log("[MOCK] Redis client disconnected");
  },
};

/**
 * Mock Prisma client for testing
 */
export const mockPrismaClient = {
  simulationJob: {
    create: async (data: any) => {
      return {
        id: "job-" + Math.random().toString(36).substr(2, 9),
        ...data.data,
        createdAt: new Date(),
      };
    },

    findUnique: async (where: any) => {
      return {
        id: where.where.id,
        assessmentId: "assessment-123",
        fundedAccountId: null,
        status: "pending",
        inputData: {},
        result: null,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
      };
    },

    findMany: async (where: any) => {
      return [
        {
          id: "job-1",
          assessmentId: "assessment-123",
          fundedAccountId: null,
          status: "completed",
          inputData: {},
          result: {},
          error: null,
          createdAt: new Date(),
          startedAt: new Date(),
          completedAt: new Date(),
        },
      ];
    },

    update: async (data: any) => {
      return {
        id: data.where.id,
        ...data.data,
        createdAt: new Date(),
      };
    },
  },

  $queryRaw: async () => {
    return [{ "1": 1 }];
  },

  $disconnect: async () => {
    console.log("[MOCK] Prisma client disconnected");
  },
};

/**
 * Test data generators
 */
export const testDataGenerators = {
  generateSimulationInput: (overrides?: Partial<SimulationInput>): SimulationInput => {
    return {
      tradeHistory: [
        {
          id: "trade-1",
          market: "BTC",
          side: "buy",
          quantity: 1,
          price: 50000,
          pnl: 1000,
          timestamp: new Date().toISOString(),
        },
      ],
      pnlData: {
        balance: 100000,
        peak: 105000,
        realized: 5000,
        unrealized: 2000,
      },
      ...overrides,
    };
  },

  generateSimulationResult: (
    overrides?: Partial<SimulationResult>
  ): SimulationResult => {
    return {
      riskMetrics: {
        valueAtRisk95: 5000.0,
        valueAtRisk99: 7500.0,
        expectedShortfall: 8000.0,
        maxDrawdown: 0.15,
        sharpeRatio: 1.5,
        sortinoRatio: 2.1,
      },
      confidenceIntervals: {
        return95Lower: -0.05,
        return95Upper: 0.15,
        return99Lower: -0.1,
        return99Upper: 0.2,
      },
      variance: 0.0025,
      pathsSimulated: 1000000,
      simulationTimeSeconds: 45.2,
      tradesAnalyzed: 10,
      currentBalance: 100000,
      peakBalance: 105000,
      ...overrides,
    };
  },

  generateAssessmentData: (
    overrides?: Partial<AssessmentData>
  ): AssessmentData => {
    return {
      id: "assessment-123",
      userId: "user-123",
      tierId: "tier-1",
      status: "passed",
      virtualAccount: {
        balance: 100000,
        peak: 105000,
        pnl: 5000,
      },
      ...overrides,
    };
  },

  generateTradeHistoryItem: (
    overrides?: Partial<TradeHistoryItem>
  ): TradeHistoryItem => {
    return {
      id: "trade-" + Math.random().toString(36).substr(2, 9),
      market: "BTC",
      side: "buy",
      quantity: 1,
      price: 50000,
      pnl: 1000,
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  },
};
