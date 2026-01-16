import { AssessmentDetails, Trade, RuleCheck, TierAverages } from '../clients/core-service';

export interface PerformanceSummary {
  totalPnl: number;
  totalPnlPercentage: number;
  tradeCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  status: string;
}

export interface MarketBreakdown {
  marketType: string;
  tradeCount: number;
  totalPnl: number;
  winRate: number;
}

export interface PeerComparison {
  tierAvgPnl: number;
  tierAvgTradeCount: number;
  userPercentile: number;
  totalTierAssessments: number;
}

export function calculatePerformanceSummary(
  assessment: AssessmentDetails,
  trades: Trade[]
): PerformanceSummary {
  const totalPnl = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.pnl, 0)
    : assessment.virtualAccount.realizedPnl;
  const startingBalance = assessment.virtualAccount.startingBalance;
  const totalPnlPercentage = (totalPnl / startingBalance) * 100;

  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);

  const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
    : 0;
  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
    : 0;

  const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  return {
    totalPnl,
    totalPnlPercentage,
    tradeCount: trades.length,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    maxDrawdown: assessment.tier.maxDrawdown,
    status: assessment.status,
  };
}

export function calculateMarketBreakdown(trades: Trade[]): MarketBreakdown[] {
  const marketMap = new Map<string, Trade[]>();

  trades.forEach(trade => {
    const marketType = getMarketType(trade.market);
    if (!marketMap.has(marketType)) {
      marketMap.set(marketType, []);
    }
    marketMap.get(marketType)!.push(trade);
  });

  return Array.from(marketMap.entries()).map(([marketType, marketTrades]) => {
    const winningTrades = marketTrades.filter(t => t.pnl > 0);
    const winRate = marketTrades.length > 0
      ? (winningTrades.length / marketTrades.length) * 100
      : 0;
    const totalPnl = marketTrades.reduce((sum, t) => sum + t.pnl, 0);

    return {
      marketType,
      tradeCount: marketTrades.length,
      totalPnl,
      winRate,
    };
  });
}

export function calculatePnlTimeSeries(
  trades: Trade[],
  startingBalance: number
): Array<{ timestamp: string; pnl: number }> {
  const sortedTrades = [...trades].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let cumulativePnl = 0;
  return sortedTrades.map(trade => {
    cumulativePnl += trade.pnl;
    return {
      timestamp: trade.timestamp,
      pnl: cumulativePnl,
    };
  });
}

export function calculateRuleComplianceTimeline(
  ruleChecks: RuleCheck[]
): {
  drawdownTimeline: Array<{ timestamp: string; value: number }>;
  riskPerTradeTimeline: Array<{ timestamp: string; value: number }>;
} {
  const drawdownChecks = ruleChecks.filter(r => r.ruleType === 'drawdown');
  const riskPerTradeChecks = ruleChecks.filter(r => r.ruleType === 'riskPerTrade');

  const drawdownTimeline = drawdownChecks
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map(check => ({
      timestamp: check.timestamp,
      value: check.value,
    }));

  const riskPerTradeTimeline = riskPerTradeChecks
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map(check => ({
      timestamp: check.timestamp,
      value: check.value,
    }));

  return {
    drawdownTimeline,
    riskPerTradeTimeline,
  };
}

export function calculatePeerComparison(
  userPnl: number,
  userTradeCount: number,
  tierAverages: TierAverages
): PeerComparison {
  // Percentile calculation: simplified to use PnL comparison
  // In production, this would query all assessments in the tier
  const userPercentile = tierAverages.totalAssessments > 0
    ? Math.min(100, (userPnl / tierAverages.avgPnl) * 50)
    : 50;

  return {
    tierAvgPnl: tierAverages.avgPnl,
    tierAvgTradeCount: tierAverages.avgTradeCount,
    userPercentile: Math.max(0, Math.min(100, userPercentile)),
    totalTierAssessments: tierAverages.totalAssessments,
  };
}

function getMarketType(market: string): string {
  if (market.includes('BTC') || market.includes('ETH')) {
    return 'crypto';
  }
  if (market.startsWith('polymarket:')) {
    return 'polymarket';
  }
  if (market.startsWith('kalshi:')) {
    return 'kalshi';
  }
  return 'other';
}
