import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getPrismaClient, disconnectPrisma } from '../src/db';
import { createLogger } from '../src/utils/logger';
import {
  calculatePerformanceSummary,
  calculateMarketBreakdown,
  calculatePnlTimeSeries,
  calculateRuleComplianceTimeline,
  calculatePeerComparison,
} from '../src/services/analytics';
import { AssessmentDetails, Trade, Position, RuleCheck, TierAverages } from '../src/clients/core-service';

const logger = createLogger('test');

// Mock data
const mockAssessment: AssessmentDetails = {
  id: 'assessment-1',
  userId: 'user-1',
  tierId: 'tier-1',
  status: 'completed',
  createdAt: '2024-01-15T10:00:00Z',
  startedAt: '2024-01-15T10:00:00Z',
  completedAt: '2024-01-15T12:00:00Z',
  virtualAccount: {
    startingBalance: 100000,
    currentBalance: 105420.50,
    peakBalance: 106000,
    realizedPnl: 5420.50,
    unrealizedPnl: 0,
  },
  tier: {
    name: 'Professional',
    maxDrawdown: 4.2,
    minTrades: 10,
  },
};

const mockTrades: Trade[] = [
  {
    id: 'trade-1',
    type: 'open',
    market: 'BTC/USD',
    side: 'long',
    quantity: 0.5,
    price: 45000,
    slippage: 10,
    fee: 5,
    pnl: 0,
    timestamp: '2024-01-15T10:00:00Z',
  },
  {
    id: 'trade-2',
    type: 'close',
    market: 'BTC/USD',
    side: 'long',
    quantity: 0.5,
    price: 46000,
    slippage: 10,
    fee: 5,
    pnl: 500,
    timestamp: '2024-01-15T11:00:00Z',
  },
  {
    id: 'trade-3',
    type: 'open',
    market: 'ETH/USD',
    side: 'long',
    quantity: 2,
    price: 2500,
    slippage: 5,
    fee: 2,
    pnl: 0,
    timestamp: '2024-01-15T11:30:00Z',
  },
  {
    id: 'trade-4',
    type: 'close',
    market: 'ETH/USD',
    side: 'long',
    quantity: 2,
    price: 2600,
    slippage: 5,
    fee: 2,
    pnl: 200,
    timestamp: '2024-01-15T12:00:00Z',
  },
];

const mockPositions: Position[] = [
  {
    id: 'position-1',
    market: 'BTC/USD',
    side: 'long',
    quantity: 0.5,
    entryPrice: 45000,
    currentPrice: 46000,
    unrealizedPnl: 500,
    openedAt: '2024-01-15T10:00:00Z',
    closedAt: '2024-01-15T11:00:00Z',
  },
  {
    id: 'position-2',
    market: 'ETH/USD',
    side: 'long',
    quantity: 2,
    entryPrice: 2500,
    currentPrice: 2600,
    unrealizedPnl: 200,
    openedAt: '2024-01-15T11:30:00Z',
    closedAt: '2024-01-15T12:00:00Z',
  },
];

const mockRuleChecks: RuleCheck[] = [
  {
    id: 'rule-1',
    ruleType: 'drawdown',
    value: 0,
    threshold: 4.2,
    status: 'passed',
    timestamp: '2024-01-15T10:00:00Z',
  },
  {
    id: 'rule-2',
    ruleType: 'drawdown',
    value: 2.3,
    threshold: 4.2,
    status: 'passed',
    timestamp: '2024-01-15T12:00:00Z',
  },
];

const mockTierAverages: TierAverages = {
  avgPnl: 3200,
  avgTradeCount: 38,
  totalAssessments: 142,
};

describe('Report Service Analytics', () => {
  it('should calculate performance summary correctly', () => {
    const summary = calculatePerformanceSummary(mockAssessment, mockTrades);

    expect(summary.totalPnl).toBe(700);
    expect(summary.totalPnlPercentage).toBeCloseTo(0.7, 1);
    expect(summary.tradeCount).toBe(4);
    expect(summary.winRate).toBe(50);
    expect(summary.profitFactor).toBeGreaterThan(0);
    expect(summary.maxDrawdown).toBe(4.2);
    expect(summary.status).toBe('completed');
  });

  it('should fall back to assessment realizedPnl when no trades', () => {
    const summary = calculatePerformanceSummary(mockAssessment, []);

    expect(summary.totalPnl).toBe(mockAssessment.virtualAccount.realizedPnl);
    expect(summary.totalPnlPercentage).toBeCloseTo(5.42, 1);
    expect(summary.tradeCount).toBe(0);
    expect(summary.winRate).toBe(0);
  });

  it('should calculate market breakdown correctly', () => {
    const breakdown = calculateMarketBreakdown(mockTrades);

    expect(breakdown.length).toBe(2);
    const btcMarket = breakdown.find(m => m.marketType === 'crypto');
    expect(btcMarket).toBeDefined();
    expect(btcMarket?.tradeCount).toBe(4);
    expect(btcMarket?.totalPnl).toBe(700);
  });

  it('should calculate PnL time series correctly', () => {
    const pnlChart = calculatePnlTimeSeries(mockTrades, mockAssessment.virtualAccount.startingBalance);

    expect(pnlChart.length).toBe(4);
    expect(pnlChart[0].pnl).toBe(0);
    expect(pnlChart[1].pnl).toBe(500);
    expect(pnlChart[3].pnl).toBe(700);
  });

  it('should calculate rule compliance timeline correctly', () => {
    const compliance = calculateRuleComplianceTimeline(mockRuleChecks);

    expect(compliance.drawdownTimeline.length).toBe(2);
    expect(compliance.drawdownTimeline[0].value).toBe(0);
    expect(compliance.drawdownTimeline[1].value).toBe(2.3);
  });

  it('should calculate peer comparison correctly', () => {
    const comparison = calculatePeerComparison(
      mockAssessment.virtualAccount.realizedPnl,
      mockTrades.length,
      mockTierAverages
    );

    expect(comparison.tierAvgPnl).toBe(3200);
    expect(comparison.tierAvgTradeCount).toBe(38);
    expect(comparison.userPercentile).toBeGreaterThanOrEqual(0);
    expect(comparison.userPercentile).toBeLessThanOrEqual(100);
    expect(comparison.totalTierAssessments).toBe(142);
  });
});

describe('Report Service Database', () => {
  let prisma: ReturnType<typeof getPrismaClient>;

  beforeAll(async () => {
    prisma = getPrismaClient();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('should create and retrieve a report', async () => {
    const summary = calculatePerformanceSummary(mockAssessment, mockTrades);
    const marketBreakdown = calculateMarketBreakdown(mockTrades);
    const pnlChart = calculatePnlTimeSeries(mockTrades, mockAssessment.virtualAccount.startingBalance);
    const compliance = calculateRuleComplianceTimeline(mockRuleChecks);
    const comparison = calculatePeerComparison(
      mockAssessment.virtualAccount.realizedPnl,
      mockTrades.length,
      mockTierAverages
    );

    const reportData = {
      summary,
      tradeHistory: mockTrades,
      positions: mockPositions,
      pnlChart,
      ruleCompliance: compliance,
      marketBreakdown,
      peerComparison: comparison,
    };

    const report = await prisma.report.create({
      data: {
        assessmentId: 'test-assessment-1',
        userId: mockAssessment.userId,
        tierId: mockAssessment.tierId,
        status: 'partial',
        data: reportData,
      },
    });

    expect(report.id).toBeDefined();
    expect(report.assessmentId).toBe('test-assessment-1');
    expect(report.status).toBe('partial');

    const retrieved = await prisma.report.findUnique({
      where: { assessmentId: 'test-assessment-1' },
    });

    expect(retrieved).toBeDefined();
    expect(retrieved?.status).toBe('partial');
    const retrievedData = retrieved?.data as any;
    expect(retrievedData.positions).toBeDefined();
    expect(retrievedData.positions.length).toBe(2);

    // Cleanup
    await prisma.report.delete({
      where: { assessmentId: 'test-assessment-1' },
    });
  });
});
