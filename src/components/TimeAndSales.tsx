import { type Component, For } from "solid-js"
import { trades } from "../stores/marketDataStore"

const TimeAndSales: Component = () => {
  return (
    <div class="h-64 flex flex-col border-b border-gray-800">
      <div class="h-10 border-b border-gray-800 flex items-center px-4">
        <span class="text-sm font-semibold">Time & Sales</span>
      </div>

      <div class="flex-1 overflow-auto">
        <For each={trades()}>
          {(trade) => (
            <div class="flex justify-between px-4 py-1 text-xs font-mono hover:bg-gray-900">
              <span class="text-gray-500">{trade.time}</span>
              <span class={trade.side === "buy" ? "text-green-500" : "text-red-500"}>{trade.price.toFixed(2)}</span>
              <span class="text-gray-400">{trade.size}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

export default TimeAndSales
