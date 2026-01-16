import axios from 'axios';
import { Logger } from '../utils/logger';

export interface MonteCarloResult {
  pathsSimulated: number;
  riskMetrics: {
    var95: number;
    cvar95: number;
    var99: number;
    cvar99: number;
  };
  confidenceIntervals: {
    ci95Lower: number;
    ci95Upper: number;
    ci99Lower: number;
    ci99Upper: number;
  };
  variance: number;
  standardDeviation: number;
}

interface SimulationJob {
  id: string;
  assessmentId: string;
  status: string;
  result?: MonteCarloResult;
}

export async function fetchSimulationResult(
  assessmentId: string,
  monteCarloServiceUrl: string,
  logger: Logger
): Promise<MonteCarloResult | null> {
  try {
    const response = await axios.get<SimulationJob[]>(
      `${monteCarloServiceUrl}/simulations?assessmentId=${assessmentId}&status=completed`
    );

    if (response.data.length === 0) {
      logger.debug('No completed simulation found', { assessmentId });
      return null;
    }

    const latestSimulation = response.data[0];
    if (!latestSimulation.result) {
      logger.warn('Simulation completed but no result found', { assessmentId });
      return null;
    }

    logger.debug('Fetched Monte Carlo simulation result', { assessmentId });
    return latestSimulation.result;
  } catch (error) {
    logger.error('Failed to fetch Monte Carlo simulation result', {
      assessmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
