import { env } from '../config/env';

export interface Report {
  assessment_id: string;
  summary: {
    pnl: number;
    trade_count: number;
    drawdown: number;
    win_rate: number;
  };
  trades: Array<{
    symbol: string;
    side: string;
    entry_price: number;
    exit_price: number;
    pnl: number;
    opened_at: string;
    closed_at: string;
  }>;
  rule_compliance: {
    daily_loss: boolean;
    max_drawdown: boolean;
    min_trades: boolean;
    max_risk_per_trade: boolean;
  };
  monte_carlo?: {
    percentile_95: number;
    percentile_99: number;
    expected_value: number;
  };
  peer_comparison?: {
    percentile: number;
    tier_average_pnl: number;
  };
}

const reportClient = {
  async get<T>(path: string): Promise<T> {
    const token = localStorage.getItem('auth_token');
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${env.REPORT_SERVICE_URL}${path}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Report service error: ${response.status}`);
    }

    return response.json();
  },
};

export async function getReport(assessmentId: string): Promise<Report> {
  return reportClient.get<Report>(`/reports/${assessmentId}`);
}
