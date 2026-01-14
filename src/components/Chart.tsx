"use client"

import { type Component, createSignal } from "solid-js"

interface ChartProps {
  symbol: string
  currentPrice: number
}

const Chart: Component<ChartProps> = (props) => {
  const [timeframe, setTimeframe] = createSignal("1H")

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column" }}>
      {/* Chart Controls */}
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          "margin-bottom": "32px",
        }}
      >
        <div style={{ display: "flex", gap: "8px" }}>
          {["1M", "5M", "15M", "1H", "4H", "1D"].map((tf) => (
            <button
              key={tf} // Added key property
              onClick={() => setTimeframe(tf)}
              style={{
                padding: "8px 16px",
                background: timeframe() === tf ? "#222222" : "transparent",
                color: timeframe() === tf ? "#ffffff" : "#666666",
                border: "1px solid #222222",
                "font-size": "11px",
                "font-weight": "600",
                "letter-spacing": "0.05em",
                transition: "all 0.3s ease",
              }}
            >
              {tf}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            style={{
              padding: "8px 16px",
              background: "transparent",
              color: "#666666",
              border: "1px solid #222222",
              "font-size": "11px",
              "font-weight": "600",
              "letter-spacing": "0.05em",
              transition: "all 0.3s ease",
            }}
          >
            INDICATORS
          </button>
        </div>
      </div>

      {/* Chart Area */}
      <div
        style={{
          flex: 1,
          background: "#111111",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          position: "relative",
          "min-height": "500px",
        }}
      >
        <svg width="100%" height="100%" viewBox="0 0 1000 500" preserveAspectRatio="none">
          {/* Grid lines */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={i} // Added key property
              x1="0"
              y1={i * 125}
              x2="1000"
              y2={i * 125}
              stroke="#1a1a1a"
              strokeWidth="1"
            />
          ))}

          {/* Price line */}
          <path
            d="M 0 400 Q 100 380, 200 350 T 400 300 T 600 200 T 800 150 L 1000 100"
            stroke="#ffffff"
            strokeWidth="2"
            fill="none"
            style={{ opacity: 0.8 }}
          />

          {/* Fill area */}
          <path
            d="M 0 400 Q 100 380, 200 350 T 400 300 T 600 200 T 800 150 L 1000 100 L 1000 500 L 0 500 Z"
            fill="url(#chartGradient)"
          />

          <defs>
            <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{ "stop-color": "#ffffff", "stop-opacity": "0.1" }} />
              <stop offset="100%" style={{ "stop-color": "#ffffff", "stop-opacity": "0" }} />
            </linearGradient>
          </defs>
        </svg>

        {/* Price labels */}
        <div
          style={{
            position: "absolute",
            right: "20px",
            top: "20px",
            "font-size": "12px",
            color: "#666666",
            "text-align": "right",
          }}
        >
          <div>${(props.currentPrice * 1.1).toLocaleString()}</div>
          <div style={{ "margin-top": "100px" }}>${props.currentPrice.toLocaleString()}</div>
          <div style={{ "margin-top": "100px" }}>${(props.currentPrice * 0.9).toLocaleString()}</div>
        </div>
      </div>
    </div>
  )
}

export default Chart
