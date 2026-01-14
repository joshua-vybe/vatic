"use client"

import { type Component, createSignal } from "solid-js"

const ChartArea: Component = () => {
  const [timeframe, setTimeframe] = createSignal("5m")

  const timeframes = ["1m", "5m", "15m", "1h", "4h", "1D"]

  return (
    <div class="flex-1 flex flex-col bg-black">
      <div class="h-10 border-b border-gray-800 flex items-center px-4 gap-2">
        <span class="text-sm text-gray-500 mr-2">Timeframe:</span>
        {timeframes.map((tf) => (
          <button
            key={tf} // Added key property
            class={`px-3 py-1 text-xs rounded transition-colors ${
              timeframe() === tf ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white hover:bg-gray-900"
            }`}
            onClick={() => setTimeframe(tf)}
          >
            {tf}
          </button>
        ))}
      </div>

      <div class="flex-1 flex items-center justify-center bg-black border-b border-gray-800">
        <div class="text-gray-600 text-center">
          <div class="text-lg mb-2">Chart Area</div>
          <div class="text-sm">Placeholder for TradingView or custom chart</div>
        </div>
      </div>
    </div>
  )
}

export default ChartArea
