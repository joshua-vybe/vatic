import axios from "axios";
import { Logger } from "../utils/logger";

export interface VirtualAccount {
  balance: number;
  peak: number;
  pnl: number;
}

export interface AssessmentData {
  id: string;
  userId: string;
  tierId: string;
  status: string;
  virtualAccount: VirtualAccount;
}

export interface TradeHistoryItem {
  id: string;
  market: string;
  side: string;
  quantity: number;
  price: number;
  pnl: number;
  timestamp: string;
}

export interface FundedAccountData {
  id: string;
  userId: string;
  status: string;
  virtualAccount: VirtualAccount;
}

export async function fetchAssessmentData(
  assessmentId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<AssessmentData> {
  try {
    const response = await axios.get<AssessmentData>(
      `${coreServiceUrl}/assessments/${assessmentId}`
    );
    return response.data;
  } catch (error) {
    logger.error("Failed to fetch assessment data", {
      assessmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchTradeHistory(
  assessmentId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<TradeHistoryItem[]> {
  try {
    const response = await axios.get<TradeHistoryItem[]>(
      `${coreServiceUrl}/trades?assessment_id=${assessmentId}`
    );
    return response.data;
  } catch (error) {
    logger.error("Failed to fetch trade history", {
      assessmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchFundedAccountData(
  fundedAccountId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<FundedAccountData> {
  try {
    const response = await axios.get<FundedAccountData>(
      `${coreServiceUrl}/funded-accounts/${fundedAccountId}`
    );
    return response.data;
  } catch (error) {
    logger.error("Failed to fetch funded account data", {
      fundedAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchTradeHistoryForFundedAccount(
  fundedAccountId: string,
  coreServiceUrl: string,
  logger: Logger
): Promise<TradeHistoryItem[]> {
  try {
    const response = await axios.get<TradeHistoryItem[]>(
      `${coreServiceUrl}/trades?funded_account_id=${fundedAccountId}`
    );
    return response.data;
  } catch (error) {
    logger.error("Failed to fetch trade history for funded account", {
      fundedAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
