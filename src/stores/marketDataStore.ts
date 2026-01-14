import { createSignal, onCleanup } from "solid-js"
import type { Quote, OrderBookLevel, Trade, Position, Order } from "../types/market"

// Market data signals
export const [quote, setQuote] = createSignal<Quote>({
  symbol: "ES",
  price: 4850.25,
  change: 12.5,
  changePercent: 0.26,
  bid: 4850.0,
  ask: 4850.5,
  volume: 1285430,
})

export const [bids, setBids] = createSignal<OrderBookLevel[]>([
  { price: 4850.0, size: 25, total: 25 },
  { price: 4849.75, size: 42, total: 67 },
  { price: 4849.5, size: 18, total: 85 },
  { price: 4849.25, size: 35, total: 120 },
  { price: 4849.0, size: 51, total: 171 },
])

export const [asks, setAsks] = createSignal<OrderBookLevel[]>([
  { price: 4850.5, size: 28, total: 28 },
  { price: 4850.75, size: 15, total: 43 },
  { price: 4851.0, size: 39, total: 82 },
  { price: 4851.25, size: 22, total: 104 },
  { price: 4851.5, size: 46, total: 150 },
])

export const [trades, setTrades] = createSignal<Trade[]>([
  { id: "1", time: "09:31:45", price: 4850.25, size: 5, side: "buy" },
  { id: "2", time: "09:31:44", price: 4850.0, size: 12, side: "sell" },
  { id: "3", time: "09:31:43", price: 4850.5, size: 3, side: "buy" },
  { id: "4", time: "09:31:42", price: 4850.25, size: 8, side: "buy" },
  { id: "5", time: "09:31:41", price: 4850.0, size: 15, side: "sell" },
])

// Account data signals
export const [accountBalance, setAccountBalance] = createSignal(125000)
export const [buyingPower, setBuyingPower] = createSignal(500000)
export const [dayPL, setDayPL] = createSignal(2450.75)

export const [positions, setPositions] = createSignal<Position[]>([
  {
    symbol: "ES",
    quantity: 2,
    avgPrice: 4838.5,
    currentPrice: 4850.25,
    unrealizedPL: 235.0,
    unrealizedPLPercent: 0.24,
  },
])

export const [orders, setOrders] = createSignal<Order[]>([
  {
    id: "ORD001",
    symbol: "ES",
    type: "limit",
    side: "buy",
    quantity: 1,
    price: 4845.0,
    status: "pending",
    time: "09:28:15",
  },
])

// Start real-time updates
export const startMarketData = () => {
  const interval = setInterval(() => {
    const currentQuote = quote()
    const priceChange = (Math.random() - 0.5) * 2
    const newPrice = currentQuote.price + priceChange

    setQuote({
      ...currentQuote,
      price: newPrice,
      bid: newPrice - 0.25,
      ask: newPrice + 0.25,
      volume: currentQuote.volume + Math.floor(Math.random() * 100),
    })

    // Update order book
    setBids(
      bids().map((level) => ({
        ...level,
        size: Math.max(1, level.size + Math.floor((Math.random() - 0.5) * 10)),
      })),
    )

    setAsks(
      asks().map((level) => ({
        ...level,
        size: Math.max(1, level.size + Math.floor((Math.random() - 0.5) * 10)),
      })),
    )

    // Add new trade
    const newTrade: Trade = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString(),
      price: newPrice,
      size: Math.floor(Math.random() * 20) + 1,
      side: Math.random() > 0.5 ? "buy" : "sell",
    }
    setTrades([newTrade, ...trades().slice(0, 19)])
  }, 1000)

  onCleanup(() => clearInterval(interval))
}
