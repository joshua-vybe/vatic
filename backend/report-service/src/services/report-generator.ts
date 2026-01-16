import { getPrismaClient } from '../db';
import { Logger } from '../utils/logger';
import {
  fetchAssessmentDetails,
  fetchTrades,
  fetchPositions,
  fetchRuleChecks,
  fetchTierAverages,
  Trade,
  Position,
} from '../clients/core-service';
import { fetchSimulationResult, MonteCarloResult } from '../clients/monte-carlo-service';
import {
  calculatePerformanceSummary,
  calculateMarketBreakdown,
  calculatePnlTimeSeries,
  calculateRuleComplianceTimeline,
  calculatePeerComparison,
  PerformanceSummary,
  MarketBreakdown,
  PeerComparison,
} from './analytics';

export interface ReportData {
  summary: PerformanceSummary;
  tradeHistory: Trade[];
  positions: Position[];
  pnlChart: Array<{ timestamp: string; pnl: number }>;
  ruleCompliance: {
    drawdownTimeline: Array<{ timestamp: string; value: number }>;
    riskPerTradeTimeline: Array<{ timestamp: string; value: number }>;
  };
  marketBreakdown: MarketBreakdown[];
  peerComparison: PeerComparison;
  monteCarlo?: MonteCarloResult;
}

export async function generateInitialReport(
  assessmentId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<string> {
  try {
    logger.info('Starting initial report generation', { assessmentId });

    // Fetch assessment first to get tierId
    const assessment = await fetchAssessmentDetails(assessmentId, coreServiceUrl, logger);

    // Fetch all required data from Core Service
    const [trades, positions, ruleChecks, tierAverages] = await Promise.all([
      fetchTrades(assessmentId, coreServiceUrl, logger),
      fetchPositions(assessmentId, coreServiceUrl, logger),
      fetchRuleChecks(assessmentId, coreServiceUrl, logger),
      fetchTierAverages(assessment.tierId, coreServiceUrl, logger),
    ]);

    // Calculate all analytics
    const summary = calculatePerformanceSummary(assessment, trades);
    const marketBreakdown = calculateMarketBreakdown(trades);
    const pnlChart = calculatePnlTimeSeries(trades, assessment.virtualAccount.startingBalance);
    const ruleCompliance = calculateRuleComplianceTimeline(ruleChecks);
    const peerComparison = calculatePeerComparison(
      assessment.virtualAccount.realizedPnl,
      trades.length,
      tierAverages
    );

    const reportData: ReportData = {
      summary,
      tradeHistory: trades,
      positions,
      pnlChart,
      ruleCompliance,
      marketBreakdown,
      peerComparison,
    };

    // Create report in database
    const prisma = getPrismaClient();
    const report = await prisma.report.create({
      data: {
        assessmentId,
        userId: assessment.userId,
        tierId: assessment.tierId,
        status: 'partial',
        data: reportData,
      },
    });

    logger.info('Initial report generated successfully', {
      assessmentId,
      reportId: report.id,
    });

    return report.id;
  } catch (error) {
    logger.error('Failed to generate initial report', {
      assessmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function enrichReportWithMonteCarlo(
  assessmentId: string,
  monteCarloServiceUrl: string,
  logger: Logger
): Promise<void> {
  try {
    logger.info('Starting Monte Carlo enrichment', { assessmentId });

    const prisma = getPrismaClient();

    // Find existing report
    const report = await prisma.report.findUnique({
      where: { assessmentId },
    });

    if (!report) {
      logger.warn('Report not found for enrichment', { assessmentId });
      return;
    }

    // Fetch Monte Carlo result
    const monteCarloResult = await fetchSimulationResult(
      assessmentId,
      monteCarloServiceUrl,
      logger
    );

    if (!monteCarloResult) {
      logger.warn('No Monte Carlo result found', { assessmentId });
      return;
    }

    // Update report with Monte Carlo data
    const reportData = report.data as ReportData;
    reportData.monteCarlo = monteCarloResult;

    await prisma.report.update({
      where: { assessmentId },
      data: {
        status: 'complete',
        data: reportData,
      },
    });

    logger.info('Report enriched with Monte Carlo data', { assessmentId });
  } catch (error) {
    logger.error('Failed to enrich report with Monte Carlo', {
      assessmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
