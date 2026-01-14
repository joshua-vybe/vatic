import { createSignal } from "solid-js"
import type { Challenge, Position, Trade } from "../types"

// Challenge store
const [challenge, setChallenge] = createSignal<Challenge>({
  tier: "Standard",
  price: 199,
  phase: 1,
  profitTarget: 8,
  maxDailyLoss: 5,
  maxDrawdown: 10,
  minTradingDays: 10,
  currentProfit: 3.2,
  currentDrawdown: 2.1,
  tradingDays: 5,
  violations: [],
  status: "active",
})

// Account store
const [balance, setBalance] = createSignal(100000)
const [equity, setEquity] = createSignal(103200)
const [dayPnl, setDayPnl] = createSignal(1200)

// Positions store
const [positions, setPositions] = createSignal<Position[]>([
  {
    id: "1",
    symbol: "BTC/USDT",
    type: "long",
    size: 0.5,
    entryPrice: 42500,
    currentPrice: 43200,
    pnl: 350,
    pnlPercent: 1.65,
    leverage: 5,
  },
])

// Trades history
const [trades, setTrades] = createSignal<Trade[]>([])

export const appStore = {
  challenge,
  setChallenge,
  balance,
  setBalance,
  equity,
  setEquity,
  dayPnl,
  setDayPnl,
  positions,
  setPositions,
  trades,
  setTrades,
}
