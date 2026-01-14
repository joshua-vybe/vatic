"use client"

import { type Component, For } from "solid-js"
import { appStore } from "../store/appStore"
import Navigation from "../components/Navigation"

interface ReportProps {
  onNavigate: (page: "dashboard" | "trade" | "report") => void
}

const Report: Component<ReportProps> = (props) => {
  const challenge = appStore.challenge()
  const passed = challenge.currentProfit >= challenge.profitTarget && challenge.tradingDays >= challenge.minTradingDays

  return (
    <div style={{ "min-height": "100vh", background: "#000000" }}>
      <Navigation currentPage="report" onNavigate={props.onNavigate} />

      <div style={{ padding: "80px", "max-width": "1400px", margin: "0 auto" }}>
        {/* Status Badge */}
        <div style={{ "text-align": "center", "margin-bottom": "80px" }}>
          <div
            class={passed ? "pulse" : ""}
            style={{
              display: "inline-block",
              padding: "24px 48px",
              background: passed ? "#ffffff" : "#222222",
              color: passed ? "#000000" : "#666666",
              "font-size": "20px",
              "font-weight": "600",
              "letter-spacing": "0.1em",
              "margin-bottom": "24px",
            }}
          >
            {passed ? "PHASE PASSED" : "IN PROGRESS"}
          </div>
          {passed && (
            <p style={{ "font-size": "14px", color: "#888888", "letter-spacing": "0.05em" }}>
              CONGRATULATIONS! PROCEED TO PHASE 2
            </p>
          )}
        </div>

        {/* Performance Metrics */}
        <div style={{ "margin-bottom": "60px" }}>
          <h2
            style={{
              "font-size": "16px",
              "font-weight": "600",
              "margin-bottom": "32px",
              "letter-spacing": "0.1em",
              color: "#ffffff",
            }}
          >
            PERFORMANCE SUMMARY
          </h2>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1px",
              background: "#222222",
            }}
          >
            <div style={{ background: "#111111", padding: "40px" }}>
              <div
                style={{ "font-size": "12px", color: "#666666", "margin-bottom": "12px", "letter-spacing": "0.05em" }}
              >
                TOTAL PROFIT
              </div>
              <div style={{ "font-size": "32px", "font-weight": "600", color: "#ffffff" }}>
                {challenge.currentProfit.toFixed(2)}%
              </div>
            </div>
            <div style={{ background: "#111111", padding: "40px" }}>
              <div
                style={{ "font-size": "12px", color: "#666666", "margin-bottom": "12px", "letter-spacing": "0.05em" }}
              >
                TRADING DAYS
              </div>
              <div style={{ "font-size": "32px", "font-weight": "600", color: "#ffffff" }}>{challenge.tradingDays}</div>
            </div>
            <div style={{ background: "#111111", padding: "40px" }}>
              <div
                style={{ "font-size": "12px", color: "#666666", "margin-bottom": "12px", "letter-spacing": "0.05em" }}
              >
                MAX DRAWDOWN
              </div>
              <div style={{ "font-size": "32px", "font-weight": "600", color: "#ffffff" }}>
                {challenge.currentDrawdown.toFixed(2)}%
              </div>
            </div>
            <div style={{ background: "#111111", padding: "40px" }}>
              <div
                style={{ "font-size": "12px", color: "#666666", "margin-bottom": "12px", "letter-spacing": "0.05em" }}
              >
                VIOLATIONS
              </div>
              <div
                style={{
                  "font-size": "32px",
                  "font-weight": "600",
                  color: challenge.violations.length === 0 ? "#ffffff" : "#666666",
                }}
              >
                {challenge.violations.length}
              </div>
            </div>
          </div>
        </div>

        {/* P&L Chart Placeholder */}
        <div style={{ "margin-bottom": "60px" }}>
          <h2
            style={{
              "font-size": "16px",
              "font-weight": "600",
              "margin-bottom": "32px",
              "letter-spacing": "0.1em",
              color: "#ffffff",
            }}
          >
            PROFIT & LOSS CURVE
          </h2>
          <div
            style={{
              background: "#111111",
              padding: "60px",
              height: "400px",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
            }}
          >
            <svg width="100%" height="300" viewBox="0 0 800 300" style={{ overflow: "visible" }}>
              <path
                d="M 0 250 Q 100 200, 200 180 T 400 120 T 600 80 T 800 50"
                stroke="#ffffff"
                strokeWidth="2"
                fill="none"
              />
              <path
                d="M 0 250 Q 100 200, 200 180 T 400 120 T 600 80 T 800 50 L 800 300 L 0 300 Z"
                fill="url(#gradient)"
                opacity="0.1"
              />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" style={{ "stop-color": "#ffffff", "stop-opacity": "0.3" }} />
                  <stop offset="100%" style={{ "stop-color": "#ffffff", "stop-opacity": "0" }} />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* Trade History */}
        <div>
          <h2
            style={{
              "font-size": "16px",
              "font-weight": "600",
              "margin-bottom": "32px",
              "letter-spacing": "0.1em",
              color: "#ffffff",
            }}
          >
            TRADE HISTORY
          </h2>
          <div style={{ background: "#111111" }}>
            <div
              style={{
                display: "grid",
                "grid-template-columns": "1fr 1fr 1fr 1fr 1fr",
                padding: "20px 32px",
                "border-bottom": "1px solid #222222",
                "font-size": "11px",
                color: "#666666",
                "letter-spacing": "0.05em",
              }}
            >
              <div>SYMBOL</div>
              <div>TYPE</div>
              <div>SIZE</div>
              <div>PRICE</div>
              <div style={{ "text-align": "right" }}>P&L</div>
            </div>
            <For
              each={[
                { symbol: "BTC/USDT", type: "LONG", size: "0.5", price: "$42,500", pnl: "+$350" },
                { symbol: "ETH/USDT", type: "SHORT", size: "2.0", price: "$2,250", pnl: "-$120" },
                { symbol: "SOL/USDT", type: "LONG", size: "10.0", price: "$98.50", pnl: "+$85" },
              ]}
            >
              {(trade) => (
                <div
                  style={{
                    display: "grid",
                    "grid-template-columns": "1fr 1fr 1fr 1fr 1fr",
                    padding: "24px 32px",
                    "border-bottom": "1px solid #222222",
                    "font-size": "13px",
                    color: "#ffffff",
                  }}
                >
                  <div>{trade.symbol}</div>
                  <div style={{ color: trade.type === "LONG" ? "#ffffff" : "#888888" }}>{trade.type}</div>
                  <div>{trade.size}</div>
                  <div>{trade.price}</div>
                  <div
                    style={{
                      "text-align": "right",
                      color: trade.pnl.startsWith("+") ? "#ffffff" : "#666666",
                    }}
                  >
                    {trade.pnl}
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Next Steps */}
        {passed && (
          <div style={{ "margin-top": "80px", "text-align": "center" }}>
            <button
              style={{
                padding: "20px 60px",
                background: "#ffffff",
                color: "#000000",
                border: "none",
                "font-size": "14px",
                "font-weight": "600",
                "letter-spacing": "0.1em",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#eeeeee"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#ffffff"
              }}
            >
              PROCEED TO PHASE 2
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default Report
