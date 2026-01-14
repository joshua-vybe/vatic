import { type Component, For } from "solid-js"
import { bids, asks } from "../stores/marketDataStore"

const OrderBook: Component = () => {
  return (
    <div class="flex-1 flex flex-col border-b border-gray-800">
      <div class="h-10 border-b border-gray-800 flex items-center px-4">
        <span class="text-sm font-semibold">Order Book</span>
      </div>

      <div class="flex-1 overflow-auto">
        {/* Asks (sells) */}
        <div class="flex flex-col-reverse">
          <For each={asks()}>
            {(level) => (
              <div class="flex justify-between px-4 py-1 text-xs font-mono hover:bg-gray-900">
                <span class="text-red-500">{level.price.toFixed(2)}</span>
                <span class="text-gray-400">{level.size}</span>
                <span class="text-gray-600">{level.total}</span>
              </div>
            )}
          </For>
        </div>

        {/* Spread */}
        <div class="border-y border-gray-700 px-4 py-2 text-xs text-center bg-gray-900">
          <span class="text-gray-500">Spread: </span>
          <span class="text-white font-mono">{(asks()[0].price - bids()[0].price).toFixed(2)}</span>
        </div>

        {/* Bids (buys) */}
        <div>
          <For each={bids()}>
            {(level) => (
              <div class="flex justify-between px-4 py-1 text-xs font-mono hover:bg-gray-900">
                <span class="text-green-500">{level.price.toFixed(2)}</span>
                <span class="text-gray-400">{level.size}</span>
                <span class="text-gray-600">{level.total}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

export default OrderBook
