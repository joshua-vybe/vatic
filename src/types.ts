export interface CryptoPair {
  symbol: string
  name: string
  price: number
  change24h: number
  volume: number
}

export interface PredictionMarket {
  id: string
  title: string
  platform: "polymarket" | "kalshi"
  probability: number
  category: string
  closesAt: Date
}

export interface Position {
  id: string
  symbol: string
  type: "long" | "short"
  size: number
  entryPrice: number
  currentPrice: number
  pnl: number
  pnlPercent: number
  leverage?: number
}

export interface Challenge {
  tier: string
  price: number
  phase: 1 | 2
  profitTarget: number
  maxDailyLoss: number
  maxDrawdown: number
  minTradingDays: number
  currentProfit: number
  currentDrawdown: number
  tradingDays: number
  violations: string[]
  status: "active" | "passed" | "failed"
}

export interface Trade {
  id: string
  symbol: string
  type: "buy" | "sell"
  size: number
  price: number
  timestamp: Date
  pnl?: number
}
