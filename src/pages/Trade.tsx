"use client"

import { type Component, createSignal, onMount, onCleanup, For } from "solid-js"
import { appStore } from "../store/appStore"
import Navigation from "../components/Navigation"
import Chart from "../components/Chart"
import OrderForm from "../components/OrderForm"

interface TradeProps {
  onNavigate: (page: "dashboard" | "trade" | "report") => void
}

const cryptoPairs = [
  "BTC/USDT",
  "ETH/USDT",
  "BNB/USDT",
  "SOL/USDT",
  "XRP/USDT",
  "ADA/USDT",
  "DOGE/USDT",
  "DOT/USDT",
  "MATIC/USDT",
  "AVAX/USDT",
]

const Trade: Component<TradeProps> = (props) => {
  const [selectedMarket, setSelectedMarket] = createSignal<"crypto" | "polymarket" | "kalshi">("crypto")
  const [selectedSymbol, setSelectedSymbol] = createSignal("BTC/USDT")
  const [currentPrice, setCurrentPrice] = createSignal(43200)

  // Simulate price updates
  let priceInterval: number
  onMount(() => {
    priceInterval = setInterval(() => {
      setCurrentPrice((prev) => {
        const change = (Math.random() - 0.5) * 100
        return Math.max(40000, prev + change)
      })
    }, 1000)
  })

  onCleanup(() => {
    clearInterval(priceInterval)
  })

  return (
    <div style={{ height: "100vh", background: "#000000", display: "flex", "flex-direction": "column" }}>
      <Navigation currentPage="trade" onNavigate={props.onNavigate} />

      {/* Market Tabs */}
      <div
        style={{
          display: "flex",
          gap: "1px",
          background: "#222222",
          "border-bottom": "1px solid #222222",
        }}
      >
        <button
          onClick={() => setSelectedMarket("crypto")}
          style={{
            flex: 1,
            padding: "16px",
            background: selectedMarket() === "crypto" ? "#000000" : "#111111",
            color: selectedMarket() === "crypto" ? "#ffffff" : "#666666",
            border: "none",
            "font-size": "13px",
            "font-weight": "600",
            "letter-spacing": "0.05em",
            transition: "all 0.3s ease",
          }}
        >
          CRYPTO
        </button>
        <button
          onClick={() => setSelectedMarket("polymarket")}
          style={{
            flex: 1,
            padding: "16px",
            background: selectedMarket() === "polymarket" ? "#000000" : "#111111",
            color: selectedMarket() === "polymarket" ? "#ffffff" : "#666666",
            border: "none",
            "font-size": "13px",
            "font-weight": "600",
            "letter-spacing": "0.05em",
            transition: "all 0.3s ease",
          }}
        >
          POLYMARKET
        </button>
        <button
          onClick={() => setSelectedMarket("kalshi")}
          style={{
            flex: 1,
            padding: "16px",
            background: selectedMarket() === "kalshi" ? "#000000" : "#111111",
            color: selectedMarket() === "kalshi" ? "#ffffff" : "#666666",
            border: "none",
            "font-size": "13px",
            "font-weight": "600",
            "letter-spacing": "0.05em",
            transition: "all 0.3s ease",
          }}
        >
          KALSHI
        </button>
      </div>

      {/* Price Ticker */}
      <div
        style={{
          background: "#111111",
          padding: "20px 40px",
          "border-bottom": "1px solid #222222",
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
        }}
      >
        <div>
          <span style={{ "font-size": "14px", color: "#888888", "margin-right": "24px" }}>{selectedSymbol()}</span>
          <span style={{ "font-size": "24px", "font-weight": "600", color: "#ffffff" }}>
            ${currentPrice().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div style={{ "font-size": "14px", color: "#888888" }}>
          BALANCE: ${appStore.balance().toLocaleString("en-US")}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "grid", "grid-template-columns": "1fr 380px", overflow: "hidden" }}>
        {/* Chart Area */}
        <div style={{ background: "#000000", padding: "40px", overflow: "auto" }}>
          <Chart symbol={selectedSymbol()} currentPrice={currentPrice()} />
        </div>

        {/* Order Form & Positions */}
        <div style={{ background: "#111111", display: "flex", "flex-direction": "column", overflow: "auto" }}>
          <OrderForm symbol={selectedSymbol()} currentPrice={currentPrice()} leverage={selectedMarket() === "crypto"} />

          {/* Positions */}
          <div style={{ flex: 1, padding: "32px", "border-top": "1px solid #222222" }}>
            <h3
              style={{
                "font-size": "14px",
                "font-weight": "600",
                "margin-bottom": "24px",
                "letter-spacing": "0.05em",
                color: "#ffffff",
              }}
            >
              OPEN POSITIONS
            </h3>
            <For each={appStore.positions()}>
              {(position) => (
                <div
                  style={{
                    background: "#000000",
                    padding: "20px",
                    "margin-bottom": "12px",
                    "border-left": `3px solid ${position.pnl >= 0 ? "#ffffff" : "#666666"}`,
                  }}
                >
                  <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "12px" }}>
                    <span style={{ "font-size": "14px", "font-weight": "600", color: "#ffffff" }}>
                      {position.symbol}
                    </span>
                    <span
                      style={{
                        "font-size": "13px",
                        color: position.type === "long" ? "#ffffff" : "#888888",
                      }}
                    >
                      {position.type.toUpperCase()}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      "justify-content": "space-between",
                      "font-size": "12px",
                      "margin-bottom": "8px",
                    }}
                  >
                    <span style={{ color: "#666666" }}>SIZE</span>
                    <span style={{ color: "#ffffff" }}>
                      {position.size} {position.leverage && `(${position.leverage}x)`}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      "justify-content": "space-between",
                      "font-size": "12px",
                      "margin-bottom": "8px",
                    }}
                  >
                    <span style={{ color: "#666666" }}>ENTRY</span>
                    <span style={{ color: "#ffffff" }}>${position.entryPrice.toLocaleString()}</span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      "justify-content": "space-between",
                      "font-size": "12px",
                      "margin-bottom": "16px",
                    }}
                  >
                    <span style={{ color: "#666666" }}>CURRENT</span>
                    <span style={{ color: "#ffffff" }}>${position.currentPrice.toLocaleString()}</span>
                  </div>
                  <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                    <div>
                      <div
                        style={{
                          "font-size": "16px",
                          "font-weight": "600",
                          color: position.pnl >= 0 ? "#ffffff" : "#666666",
                        }}
                      >
                        {position.pnl >= 0 ? "+" : ""}${position.pnl.toFixed(2)}
                      </div>
                      <div style={{ "font-size": "11px", color: "#666666" }}>
                        {position.pnlPercent >= 0 ? "+" : ""}
                        {position.pnlPercent.toFixed(2)}%
                      </div>
                    </div>
                    <button
                      style={{
                        padding: "8px 16px",
                        background: "#222222",
                        color: "#ffffff",
                        border: "none",
                        "font-size": "11px",
                        "font-weight": "600",
                        "letter-spacing": "0.05em",
                        transition: "background 0.3s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#333333"
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#222222"
                      }}
                    >
                      CLOSE
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Trade
