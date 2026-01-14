"use client"

import { type Component, createSignal, For, Show } from "solid-js"
import { positions, orders } from "../stores/marketDataStore"

const BottomPanel: Component = () => {
  const [activeTab, setActiveTab] = createSignal<"positions" | "orders" | "history">("positions")

  return (
    <div class="h-48 border-t border-gray-800 flex flex-col">
      {/* Tabs */}
      <div class="h-10 border-b border-gray-800 flex items-center px-4 gap-4">
        <button
          class={`text-sm ${
            activeTab() === "positions" ? "text-white border-b-2 border-blue-500" : "text-gray-500 hover:text-gray-300"
          }`}
          onClick={() => setActiveTab("positions")}
        >
          Positions
        </button>
        <button
          class={`text-sm ${
            activeTab() === "orders" ? "text-white border-b-2 border-blue-500" : "text-gray-500 hover:text-gray-300"
          }`}
          onClick={() => setActiveTab("orders")}
        >
          Orders
        </button>
        <button
          class={`text-sm ${
            activeTab() === "history" ? "text-white border-b-2 border-blue-500" : "text-gray-500 hover:text-gray-300"
          }`}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
      </div>

      {/* Content */}
      <div class="flex-1 overflow-auto">
        <Show when={activeTab() === "positions"}>
          <table class="w-full text-xs">
            <thead class="bg-gray-900 sticky top-0">
              <tr class="text-left text-gray-500">
                <th class="px-4 py-2">Symbol</th>
                <th class="px-4 py-2">Qty</th>
                <th class="px-4 py-2">Avg Price</th>
                <th class="px-4 py-2">Current</th>
                <th class="px-4 py-2">Unrealized P/L</th>
                <th class="px-4 py-2">%</th>
              </tr>
            </thead>
            <tbody class="font-mono">
              <For each={positions()}>
                {(position) => (
                  <tr class="border-b border-gray-900 hover:bg-gray-900">
                    <td class="px-4 py-2">{position.symbol}</td>
                    <td class="px-4 py-2">{position.quantity}</td>
                    <td class="px-4 py-2">{position.avgPrice.toFixed(2)}</td>
                    <td class="px-4 py-2">{position.currentPrice.toFixed(2)}</td>
                    <td class={`px-4 py-2 ${position.unrealizedPL >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {position.unrealizedPL >= 0 ? "+" : ""}
                      {position.unrealizedPL.toFixed(2)}
                    </td>
                    <td class={`px-4 py-2 ${position.unrealizedPLPercent >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {position.unrealizedPLPercent >= 0 ? "+" : ""}
                      {position.unrealizedPLPercent.toFixed(2)}%
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>

        <Show when={activeTab() === "orders"}>
          <table class="w-full text-xs">
            <thead class="bg-gray-900 sticky top-0">
              <tr class="text-left text-gray-500">
                <th class="px-4 py-2">Time</th>
                <th class="px-4 py-2">Symbol</th>
                <th class="px-4 py-2">Side</th>
                <th class="px-4 py-2">Type</th>
                <th class="px-4 py-2">Qty</th>
                <th class="px-4 py-2">Price</th>
                <th class="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody class="font-mono">
              <For each={orders()}>
                {(order) => (
                  <tr class="border-b border-gray-900 hover:bg-gray-900">
                    <td class="px-4 py-2">{order.time}</td>
                    <td class="px-4 py-2">{order.symbol}</td>
                    <td class={`px-4 py-2 ${order.side === "buy" ? "text-green-500" : "text-red-500"}`}>
                      {order.side.toUpperCase()}
                    </td>
                    <td class="px-4 py-2">{order.type}</td>
                    <td class="px-4 py-2">{order.quantity}</td>
                    <td class="px-4 py-2">{order.price?.toFixed(2) || "-"}</td>
                    <td class="px-4 py-2 text-yellow-500">{order.status}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>

        <Show when={activeTab() === "history"}>
          <div class="p-8 text-center text-gray-600">
            <div>No trade history</div>
          </div>
        </Show>
      </div>
    </div>
  )
}

export default BottomPanel
