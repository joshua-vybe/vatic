"use client"

import { type Component, createSignal } from "solid-js"

interface OrderFormProps {
  symbol: string
  currentPrice: number
  leverage: boolean
}

const OrderForm: Component<OrderFormProps> = (props) => {
  const [orderType, setOrderType] = createSignal<"market" | "limit">("market")
  const [side, setSide] = createSignal<"buy" | "sell">("buy")
  const [size, setSize] = createSignal("")
  const [price, setPrice] = createSignal("")
  const [leverageValue, setLeverageValue] = createSignal(1)

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    console.log("[v0] Order submitted:", {
      symbol: props.symbol,
      type: orderType(),
      side: side(),
      size: size(),
      price: orderType() === "limit" ? price() : props.currentPrice,
      leverage: leverageValue(),
    })
  }

  return (
    <div style={{ padding: "32px", "border-bottom": "1px solid #222222" }}>
      <h3
        style={{
          "font-size": "14px",
          "font-weight": "600",
          "margin-bottom": "24px",
          "letter-spacing": "0.05em",
          color: "#ffffff",
        }}
      >
        NEW ORDER
      </h3>

      {/* Buy/Sell Toggle */}
      <div
        style={{
          display: "grid",
          "grid-template-columns": "1fr 1fr",
          gap: "1px",
          "margin-bottom": "24px",
          background: "#222222",
        }}
      >
        <button
          onClick={() => setSide("buy")}
          style={{
            padding: "16px",
            background: side() === "buy" ? "#ffffff" : "#000000",
            color: side() === "buy" ? "#000000" : "#666666",
            border: "none",
            "font-size": "13px",
            "font-weight": "600",
            "letter-spacing": "0.05em",
            transition: "all 0.3s ease",
          }}
        >
          BUY
        </button>
        <button
          onClick={() => setSide("sell")}
          style={{
            padding: "16px",
            background: side() === "sell" ? "#666666" : "#000000",
            color: side() === "sell" ? "#ffffff" : "#666666",
            border: "none",
            "font-size": "13px",
            "font-weight": "600",
            "letter-spacing": "0.05em",
            transition: "all 0.3s ease",
          }}
        >
          SELL
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
        {/* Order Type */}
        <div>
          <label
            style={{
              display: "block",
              "font-size": "11px",
              color: "#666666",
              "margin-bottom": "8px",
              "letter-spacing": "0.05em",
            }}
          >
            ORDER TYPE
          </label>
          <select
            value={orderType()}
            onChange={(e) => setOrderType(e.currentTarget.value as "market" | "limit")}
            style={{
              width: "100%",
              padding: "12px",
              background: "#000000",
              color: "#ffffff",
              border: "1px solid #222222",
              "font-size": "13px",
            }}
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </div>

        {/* Size */}
        <div>
          <label
            style={{
              display: "block",
              "font-size": "11px",
              color: "#666666",
              "margin-bottom": "8px",
              "letter-spacing": "0.05em",
            }}
          >
            SIZE
          </label>
          <input
            type="text"
            value={size()}
            onInput={(e) => setSize(e.currentTarget.value)}
            placeholder="0.00"
            style={{
              width: "100%",
              padding: "12px",
              background: "#000000",
              color: "#ffffff",
              border: "1px solid #222222",
              "font-size": "13px",
            }}
          />
        </div>

        {/* Limit Price */}
        {orderType() === "limit" && (
          <div>
            <label
              style={{
                display: "block",
                "font-size": "11px",
                color: "#666666",
                "margin-bottom": "8px",
                "letter-spacing": "0.05em",
              }}
            >
              PRICE
            </label>
            <input
              type="text"
              value={price()}
              onInput={(e) => setPrice(e.currentTarget.value)}
              placeholder={props.currentPrice.toString()}
              style={{
                width: "100%",
                padding: "12px",
                background: "#000000",
                color: "#ffffff",
                border: "1px solid #222222",
                "font-size": "13px",
              }}
            />
          </div>
        )}

        {/* Leverage Slider */}
        {props.leverage && (
          <div>
            <label
              style={{
                display: "flex",
                "justify-content": "space-between",
                "font-size": "11px",
                color: "#666666",
                "margin-bottom": "8px",
                "letter-spacing": "0.05em",
              }}
            >
              <span>LEVERAGE</span>
              <span>{leverageValue()}x</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={leverageValue()}
              onInput={(e) => setLeverageValue(Number.parseInt(e.currentTarget.value))}
              style={{
                width: "100%",
                height: "2px",
                background: "#222222",
                appearance: "none",
                outline: "none",
              }}
            />
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "16px",
            background: side() === "buy" ? "#ffffff" : "#666666",
            color: side() === "buy" ? "#000000" : "#ffffff",
            border: "none",
            "font-size": "13px",
            "font-weight": "600",
            "letter-spacing": "0.05em",
            "margin-top": "8px",
            transition: "opacity 0.3s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "0.9"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "1"
          }}
        >
          {side() === "buy" ? "PLACE BUY ORDER" : "PLACE SELL ORDER"}
        </button>
      </form>
    </div>
  )
}

export default OrderForm
