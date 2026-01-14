import type { Component } from "solid-js"
import { quote } from "../stores/marketDataStore"

const SymbolBar: Component = () => {
  const currentQuote = quote

  return (
    <div class="h-14 bg-gray-950 border-b border-gray-800 flex items-center px-4 gap-8">
      <div class="flex items-baseline gap-2">
        <span class="text-xl font-semibold">{currentQuote().symbol}</span>
        <span class="text-xs text-gray-500">E-mini S&P 500</span>
      </div>

      <div class="flex items-baseline gap-2 font-mono">
        <span class="text-2xl font-semibold">{currentQuote().price.toFixed(2)}</span>
        <span class={`text-sm ${currentQuote().change >= 0 ? "text-green-500" : "text-red-500"}`}>
          {currentQuote().change >= 0 ? "+" : ""}
          {currentQuote().change.toFixed(2)} ({currentQuote().changePercent.toFixed(2)}%)
        </span>
      </div>

      <div class="flex gap-6 font-mono text-sm">
        <div class="flex flex-col">
          <span class="text-xs text-gray-500">Bid</span>
          <span class="text-green-500">{currentQuote().bid.toFixed(2)}</span>
        </div>
        <div class="flex flex-col">
          <span class="text-xs text-gray-500">Ask</span>
          <span class="text-red-500">{currentQuote().ask.toFixed(2)}</span>
        </div>
        <div class="flex flex-col">
          <span class="text-xs text-gray-500">Volume</span>
          <span class="text-gray-300">{currentQuote().volume.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}

export default SymbolBar
