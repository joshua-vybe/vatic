// User & Authentication
export interface User {
  id: string;
  email: string;
  created_at: Date;
}

// Tiers & Purchases
export interface Tier {
  id: string;
  name: string;
  price: number;
  account_size: number;
  max_drawdown: number;
  min_trades: number;
  max_risk_per_trade: number;
  profit_split: number;
}

export interface Purchase {
  id: string;
  user_id: string;
  tier_id: string;
  stripe_session_id?: string;
  status: 'pending' | 'completed' | 'failed';
  created_at: Date;
}

// Assessments
export interface Assessment {
  id: string;
  user_id: string;
  tier_id: string;
  status: 'pending' | 'active' | 'paused' | 'passed' | 'failed';
  balance: number;
  peak_balance: number;
  starting_balance: number;
  trading_days_completed?: number;
  min_trading_days?: number;
  total_trades?: number;
  min_trades?: number;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
}

// Trading
export interface Position {
  id: string;
  assessment_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entry_price: number;
  current_price: number;
  size: number;
  pnl: number;
  pnl_percent: number;
  opened_at: Date;
  closed_at?: Date;
}

export interface Trade {
  id: string;
  assessment_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  entry_price: number;
  exit_price?: number;
  size: number;
  pnl?: number;
  opened_at: Date;
  closed_at?: Date;
}

export interface Order {
  id: string;
  assessment_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  size: number;
  price?: number;
  status: 'pending' | 'filled' | 'cancelled';
  created_at: Date;
}

// Rules & Violations
export interface RuleStatus {
  daily_loss: {
    value: number;
    threshold: number;
    status: 'safe' | 'warning' | 'violated';
  };
  max_drawdown: {
    value: number;
    threshold: number;
    status: 'safe' | 'warning' | 'violated';
  };
  min_trades: {
    value: number;
    threshold: number;
    status: 'safe' | 'warning' | 'violated';
  };
  max_risk_per_trade: {
    value: number;
    threshold: number;
    status: 'safe' | 'warning' | 'violated';
  };
}

export interface Violation {
  id: string;
  assessment_id: string;
  type: 'daily_loss' | 'drawdown' | 'risk_per_trade' | 'min_trades';
  message: string;
  timestamp: Date;
  severity: 'warning' | 'critical';
}

export interface Warning {
  id: string;
  assessment_id: string;
  type: string;
  message: string;
  timestamp: Date;
}

// Funded Accounts
export interface FundedAccount {
  id: string;
  user_id: string;
  tier_id: string;
  balance: number;
  starting_balance: number;
  total_withdrawals: number;
  status: 'active' | 'suspended' | 'closed';
  created_at: Date;
}

export interface Withdrawal {
  id: string;
  funded_account_id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
  requested_at: Date;
  processed_at?: Date;
}

// Markets
export interface Market {
  id: string;
  symbol: string;
  name: string;
  type: 'crypto' | 'polymarket' | 'kalshi';
  price: number;
  change24h: number;
  volume24h: number;
  probability?: number;
}

// Legacy Challenge interface (kept for backward compatibility)
export interface Challenge {
  id: string;
  tier: 'starter' | 'standard' | 'professional' | 'elite';
  price: number;
  accountSize: number;
  phase: 1 | 2 | 'funded';
  profitTarget: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  minTradingDays: number;
  daysTraded: number;
  totalTrades: number;
  currentBalance: number;
  startingBalance: number;
  violations: Violation[];
}
