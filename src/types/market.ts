export interface Quote {
  symbol: string
  price: number
  change: number
  changePercent: number
  bid: number
  ask: number
  volume: number
}

export interface OrderBookLevel {
  price: number
  size: number
  total: number
}

export interface Trade {
  id: string
  time: string
  price: number
  size: number
  side: "buy" | "sell"
}

export interface Position {
  symbol: string
  quantity: number
  avgPrice: number
  currentPrice: number
  unrealizedPL: number
  unrealizedPLPercent: number
}

export interface Order {
  id: string
  symbol: string
  type: "market" | "limit" | "stop" | "stop-limit"
  side: "buy" | "sell"
  quantity: number
  price?: number
  stopPrice?: number
  status: "pending" | "filled" | "cancelled"
  time: string
}
