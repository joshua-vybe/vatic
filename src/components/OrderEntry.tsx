"use client"

import { type Component, createSignal } from "solid-js"
import { quote } from "../stores/marketDataStore"

const OrderEntry: Component = () => {
  const [side, setSide] = createSignal<"buy" | "sell">("buy")
  const [orderType, setOrderType] = createSignal<"market" | "limit" | "stop" | "stop-limit">("limit")
  const [quantity, setQuantity] = createSignal(1)
  const [limitPrice, setLimitPrice] = createSignal("")
  const [stopPrice, setStopPrice] = createSignal("")

  const currentQuote = quote

  const handleSubmitOrder = () => {
    console.log("Order submitted:", {
      side: side(),
      type: orderType(),
      quantity: quantity(),
      limitPrice: limitPrice(),
      stopPrice: stopPrice(),
    })
  }

  return (
    <div class="flex-1 flex flex-col p-4">
      <div class="text-sm font-semibold mb-4">Order Entry</div>

      {/* Buy/Sell Toggle */}
      <div class="flex gap-2 mb-4">
        <button
          class={`flex-1 py-2 rounded transition-colors ${
            side() === "buy" ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
          onClick={() => setSide("buy")}
        >
          Buy
        </button>
        <button
          class={`flex-1 py-2 rounded transition-colors ${
            side() === "sell" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
          onClick={() => setSide("sell")}
        >
          Sell
        </button>
      </div>

      {/* Order Type */}
      <div class="mb-3">
        <label class="text-xs text-gray-500 block mb-1">Order Type</label>
        <select
          class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
          value={orderType()}
          onChange={(e) => setOrderType(e.currentTarget.value as any)}
        >
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
          <option value="stop-limit">Stop Limit</option>
        </select>
      </div>

      {/* Quantity */}
      <div class="mb-3">
        <label class="text-xs text-gray-500 block mb-1">Quantity</label>
        <input
          type="number"
          class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          value={quantity()}
          onInput={(e) => setQuantity(Number.parseInt(e.currentTarget.value) || 1)}
          min="1"
        />
      </div>

      {/* Limit Price */}
      {(orderType() === "limit" || orderType() === "stop-limit") && (
        <div class="mb-3">
          <label class="text-xs text-gray-500 block mb-1">Limit Price</label>
          <input
            type="text"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
            value={limitPrice()}
            onInput={(e) => setLimitPrice(e.currentTarget.value)}
            placeholder={currentQuote().price.toFixed(2)}
          />
        </div>
      )}

      {/* Stop Price */}
      {(orderType() === "stop" || orderType() === "stop-limit") && (
        <div class="mb-3">
          <label class="text-xs text-gray-500 block mb-1">Stop Price</label>
          <input
            type="text"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
            value={stopPrice()}
            onInput={(e) => setStopPrice(e.currentTarget.value)}
            placeholder={currentQuote().price.toFixed(2)}
          />
        </div>
      )}

      {/* Estimated Cost */}
      <div class="mb-4 p-3 bg-gray-900 rounded">
        <div class="flex justify-between text-xs mb-1">
          <span class="text-gray-500">Estimated</span>
          <span class="font-mono">
            ${((Number.parseFloat(limitPrice()) || currentQuote().price) * quantity()).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Submit Button */}
      <button
        class={`w-full py-3 rounded font-semibold transition-colors ${
          side() === "buy" ? "bg-green-600 hover:bg-green-500 text-white" : "bg-red-600 hover:bg-red-500 text-white"
        }`}
        onClick={handleSubmitOrder}
      >
        {side() === "buy" ? "Buy" : "Sell"} {quantity()} @ {orderType()}
      </button>
    </div>
  )
}

export default OrderEntry
