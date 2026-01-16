import axios, { AxiosInstance } from "axios";
import { Logger } from "../utils/logger";

export interface SimulationInput {
  tradeHistory: Array<{
    id: string;
    market: string;
    side: string;
    quantity: number;
    price: number;
    pnl: number;
    timestamp: string;
  }>;
  pnlData: {
    balance: number;
    peak: number;
    realized: number;
    unrealized: number;
  };
}

export interface SimulationResult {
  riskMetrics: Record<string, number>;
  confidenceIntervals: Record<string, number>;
  variance: number;
  pathsSimulated: number;
  simulationTimeSeconds?: number;
  tradesAnalyzed?: number;
  currentBalance?: number;
  peakBalance?: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callRayServeSimulation(
  input: SimulationInput,
  rayServeUrl: string,
  logger: Logger
): Promise<SimulationResult> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = axios.create({
        timeout: TIMEOUT_MS,
      });

      const response = await client.post<SimulationResult>(
        `${rayServeUrl}/simulate`,
        input
      );

      logger.info("Ray Serve simulation completed", {
        attempt,
        pathsSimulated: response.data.pathsSimulated,
      });

      return response.data;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error));
      logger.warn("Ray Serve simulation attempt failed", {
        attempt,
        error: lastError.message,
      });

      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delayMs);
      }
    }
  }

  throw new Error(
    `Ray Serve simulation failed after ${MAX_RETRIES} attempts: ${lastError?.message}`
  );
}

export async function healthCheckRayServe(
  rayServeUrl: string,
  logger: Logger
): Promise<boolean> {
  try {
    const client = axios.create({
      timeout: 5000,
    });

    await client.get(`${rayServeUrl}/health`);
    return true;
  } catch (error) {
    logger.warn("Ray Serve health check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
