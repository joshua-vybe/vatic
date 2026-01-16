"use client"

import { type Component, createSignal, onMount, For, Show, createEffect } from "solid-js"
import { animate, spring } from "motion"
import { toast } from "sonner"
import Layout from "../components/Layout"
import Chart from "../components/Chart"
import { CRYPTO_PAIRS, PREDICTION_MARKETS } from "../lib/crypto-data"
import { tradingStore } from "../stores/tradingStore"
import { marketDataStore } from "../stores/marketDataStore"
import { assessmentStore } from "../stores/assessmentStore"
import { appStore } from "../stores/appStore"
import { websocket } from "../lib/socket"
import { LoadingSpinner } from "../components/LoadingSpinner"
import type { Position, Market, Order } from "../types"

const Trade: Component = () => {
  const [activeTab, setActiveTab] = createSignal<"crypto" | "polymarket" | "kalshi">("crypto")
  const [selectedMarket, setSelectedMarket] = createSignal<Market>({
    id: "BTC/USDT",
    symbol: "BTC/USDT",
    name: "Bitcoin",
    type: "crypto",
    price: 42350.5,
    change24h: 2.35,
    volume24h: 28450000000,
  })
  const [previousMarketSymbol, setPreviousMarketSymbol] = createSignal<string | null>(null)

  const [orderSide, setOrderSide] = createSignal<"BUY" | "SELL">("BUY")
  const [orderType, setOrderType] = createSignal<"MARKET" | "LIMIT">("MARKET")
  const [orderSize, setOrderSize] = createSignal("")
  const [leverage, setLeverage] = createSignal(1)
  const [limitPrice, setLimitPrice] = createSignal("")
  const [searchTerm, setSearchTerm] = createSignal("")
  const [showSearch, setShowSearch] = createSignal(false)
  const [loading, setLoading] = createSignal(false)

  let tickerRef: HTMLDivElement | undefined
  let chartRef: HTMLDivElement | undefined
  let orderFormRef: HTMLDivElement | undefined

  onMount(async () => {
    try {
      // Fetch assessments if not already loaded
      if (assessmentStore.state.assessments.length === 0) {
        await assessmentStore.fetchAssessments()
      }

      // Get or select assessment
      let assessmentId = assessmentStore.state.currentAssessment?.id
      if (!assessmentId && assessmentStore.state.assessments.length > 0) {
        assessmentId = assessmentStore.state.assessments[0].id
        await assessmentStore.selectAssessment(assessmentId)
      }

      if (assessmentId) {
        await tradingStore.fetchPositions(assessmentId)
        await tradingStore.fetchTrades(assessmentId)
        websocket.subscribe(assessmentId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load trading data'
      toast.error(message)
    }

    if (tickerRef) {
      animate(tickerRef, { opacity: [0, 1] }, { duration: 0.4, easing: spring({ stiffness: 250, damping: 30 }) })
    }
    if (chartRef) {
      animate(
        chartRef,
        { opacity: [0, 1], y: [10, 0] },
        { duration: 0.5, delay: 0.1, easing: spring({ stiffness: 250, damping: 30 }) },
      )
    }
    if (orderFormRef) {
      animate(
        orderFormRef,
        { opacity: [0, 1], x: [20, 0] },
        { duration: 0.5, delay: 0.2, easing: spring({ stiffness: 250, damping: 30 }) },
      )
    }
  })

  createEffect(() => {
    const price = marketDataStore.getPrice(selectedMarket().symbol)
    if (price) {
      setSelectedMarket(m => ({ ...m, price }))
    }
  })

  // Subscribe to market when selected, unsubscribe from previous
  createEffect(() => {
    const market = selectedMarket().symbol
    const prevMarket = previousMarketSymbol()
    
    if (prevMarket && prevMarket !== market) {
      marketDataStore.unsubscribeFromMarket(prevMarket)
    }
    
    if (market) {
      marketDataStore.subscribeToMarket(market)
      setPreviousMarketSymbol(market)
    }
    
    return () => {
      // Cleanup: unsubscribe when component unmounts
      if (market) {
        marketDataStore.unsubscribeFromMarket(market)
      }
    }
  })

  const filteredMarkets = () => {
    const term = searchTerm().toLowerCase()
    const markets = marketDataStore.getMarkets()
    
    if (markets.length === 0) {
      // Fallback to static data if no markets loaded from backend
      if (activeTab() === "crypto") {
        return CRYPTO_PAIRS.filter(
          (pair) => pair.symbol.toLowerCase().includes(term) || pair.name.toLowerCase().includes(term),
        )
      } else if (activeTab() === "polymarket") {
        return PREDICTION_MARKETS.polymarket.filter((market) => market.name.toLowerCase().includes(term))
      } else {
        return PREDICTION_MARKETS.kalshi.filter((market) => market.name.toLowerCase().includes(term))
      }
    }
    
    return markets.filter(
      (market) => 
        market.type === activeTab() &&
        (market.symbol.toLowerCase().includes(term) || market.name.toLowerCase().includes(term))
    )
  }

  const handlePlaceOrder = async () => {
    if (!orderSize() || (orderType() === "LIMIT" && !limitPrice())) {
      toast.error("Please fill in all required fields")
      return
    }

    const assessmentId = assessmentStore.state.currentAssessment?.id
    if (!assessmentId) {
      toast.error("No active assessment")
      return
    }

    setLoading(true)
    try {
      await tradingStore.placeOrder({
        assessment_id: assessmentId,
        symbol: selectedMarket().symbol,
        side: orderSide(),
        type: orderType(),
        size: Number.parseFloat(orderSize()),
        price: orderType() === "LIMIT" ? Number.parseFloat(limitPrice()) : undefined,
      })
      
      toast.success("Order placed successfully")
      setOrderSize("")
      setLimitPrice("")
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to place order'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const closePosition = async (positionId: string) => {
    setLoading(true)
    try {
      await tradingStore.closePosition(positionId)
      toast.success("Position closed successfully")
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to close position'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const totalExposure = () => {
    return appStore.getTotalExposure();
  }

  const totalPnL = () => {
    return tradingStore.state.positions.reduce((sum, pos) => sum + pos.pnl, 0)
  }

  return (
    <Layout>
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div class="lg:col-span-3 space-y-6">
          <div class="flex gap-4 border-b border-[#222222]">
            <button
              onClick={() => setActiveTab("crypto")}
              class={`px-6 py-3 text-sm font-semibold transition-colors ${
                activeTab() === "crypto" ? "border-b-2 border-white text-white" : "text-[#666666] hover:text-[#aaaaaa]"
              }`}
            >
              CRYPTO
            </button>
            <button
              onClick={() => setActiveTab("polymarket")}
              class={`px-6 py-3 text-sm font-semibold transition-colors ${
                activeTab() === "polymarket"
                  ? "border-b-2 border-white text-white"
                  : "text-[#666666] hover:text-[#aaaaaa]"
              }`}
            >
              POLYMARKET
            </button>
            <button
              onClick={() => setActiveTab("kalshi")}
              class={`px-6 py-3 text-sm font-semibold transition-colors ${
                activeTab() === "kalshi" ? "border-b-2 border-white text-white" : "text-[#666666] hover:text-[#aaaaaa]"
              }`}
            >
              KALSHI
            </button>
          </div>

          <div class="relative">
            <input
              type="text"
              value={searchTerm()}
              onInput={(e) => setSearchTerm(e.currentTarget.value)}
              onFocus={() => setShowSearch(true)}
              placeholder={`Search ${activeTab()} markets...`}
              class="w-full bg-[#111111] border border-[#222222] px-4 py-3 text-sm outline-none focus:border-white transition-colors"
            />
            <Show when={showSearch() && searchTerm()}>
              <div class="absolute top-full left-0 right-0 bg-[#111111] border border-[#222222] mt-1 max-h-64 overflow-y-auto z-10">
                <For each={filteredMarkets().slice(0, 10)}>
                  {(market) => (
                    <div
                      onClick={() => {
                        setSelectedMarket({
                          id: market.symbol || market.id,
                          symbol: market.symbol || market.id,
                          name: market.name,
                          type: market.type,
                          price: market.price,
                          change24h: market.change24h,
                          volume24h: market.volume24h,
                          probability: market.probability,
                        })
                        setShowSearch(false)
                        setSearchTerm("")
                      }}
                      class="px-4 py-3 hover:bg-[#1a1a1a] cursor-pointer transition-colors text-sm"
                    >
                      {market.name}
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div ref={tickerRef} class="bg-[#111111] p-6">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-xs text-[#666666] mb-1">{selectedMarket().symbol}</div>
                <div class="text-3xl font-bold">
                  {activeTab() === "crypto"
                    ? `${selectedMarket().price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                    : `${(selectedMarket().probability! * 100).toFixed(1)}%`}
                </div>
              </div>
              <div class={`text-lg ${selectedMarket().change24h >= 0 ? "text-white" : "text-[#666666]"}`}>
                {selectedMarket().change24h >= 0 ? "+" : ""}
                {selectedMarket().change24h.toFixed(2)}%
              </div>
            </div>
          </div>

          <div ref={chartRef} class="bg-[#111111] p-6">
            <Chart symbol={selectedMarket().symbol} type={activeTab()} />
          </div>

          <div class="bg-[#111111] p-6">
            <h3 class="text-sm font-semibold mb-4 tracking-widest">POSITIONS</h3>
            <Show
              when={tradingStore.state.positions.length > 0}
              fallback={
                <div class="text-center py-12 text-[#666666] text-sm">
                  No open positions. Place your first trade to get started.
                </div>
              }
            >
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-[#222222]">
                      <th class="text-left pb-3 text-[#666666] font-medium">SYMBOL</th>
                      <th class="text-left pb-3 text-[#666666] font-medium">SIDE</th>
                      <th class="text-right pb-3 text-[#666666] font-medium">SIZE</th>
                      <th class="text-right pb-3 text-[#666666] font-medium">ENTRY</th>
                      <th class="text-right pb-3 text-[#666666] font-medium">CURRENT</th>
                      <th class="text-right pb-3 text-[#666666] font-medium">P&L</th>
                      <th class="text-right pb-3 text-[#666666] font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={tradingStore.state.positions}>
                      {(position) => (
                        <tr class="border-b border-[#222222] hover:bg-[#1a1a1a] transition-colors">
                          <td class="py-4">{position.symbol}</td>
                          <td class="py-4">
                            <span class="uppercase text-xs">{position.side}</span>
                          </td>
                          <td class="py-4 text-right">{position.size}</td>
                          <td class="py-4 text-right">${position.entry_price.toLocaleString()}</td>
                          <td class="py-4 text-right">${position.current_price.toLocaleString()}</td>
                          <td class={`py-4 text-right ${position.pnl >= 0 ? "text-white" : "text-[#666666]"}`}>
                            {position.pnl >= 0 ? "+" : ""}${position.pnl.toFixed(2)} ({position.pnl_percent.toFixed(2)}%)
                          </td>
                          <td class="py-4 text-right">
                            <button
                              onClick={() => closePosition(position.id)}
                              disabled={loading()}
                              class="text-xs text-[#666666] hover:text-white transition-colors disabled:opacity-50"
                            >
                              CLOSE
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </div>

          <div class="bg-[#111111] p-6">
            <h3 class="text-sm font-semibold mb-4 tracking-widest">PORTFOLIO SUMMARY</h3>
            <div class="grid grid-cols-3 gap-6">
              <div>
                <div class="text-xs text-[#666666] mb-1">TOTAL EXPOSURE</div>
                <div class="text-xl font-semibold">${totalExposure().toLocaleString("en-US")}</div>
              </div>
              <div>
                <div class="text-xs text-[#666666] mb-1">TOTAL P&L</div>
                <div class={`text-xl font-semibold ${totalPnL() >= 0 ? "text-white" : "text-[#666666]"}`}>
                  {totalPnL() >= 0 ? "+" : ""}${totalPnL().toFixed(2)}
                </div>
              </div>
              <div>
                <div class="text-xs text-[#666666] mb-1">OPEN POSITIONS</div>
                <div class="text-xl font-semibold">{tradingStore.state.positions.length}</div>
              </div>
            </div>
          </div>
        </div>

        <div ref={orderFormRef} class="space-y-6">
          <div class="bg-[#111111] p-6 sticky top-6">
            <h3 class="text-sm font-semibold mb-6 tracking-widest">ORDER</h3>

            <div class="grid grid-cols-2 gap-2 mb-6">
              <button
                onClick={() => setOrderSide("BUY")}
                disabled={loading()}
                class={`py-3 text-sm font-semibold transition-all disabled:opacity-50 ${
                  orderSide() === "BUY" ? "bg-white text-black" : "bg-[#222222] text-[#666666] hover:bg-[#2a2a2a]"
                }`}
              >
                BUY
              </button>
              <button
                onClick={() => setOrderSide("SELL")}
                disabled={loading()}
                class={`py-3 text-sm font-semibold transition-all disabled:opacity-50 ${
                  orderSide() === "SELL" ? "bg-white text-black" : "bg-[#222222] text-[#666666] hover:bg-[#2a2a2a]"
                }`}
              >
                SELL
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2 mb-6">
              <button
                onClick={() => setOrderType("MARKET")}
                disabled={loading()}
                class={`py-2 text-xs transition-all disabled:opacity-50 ${
                  orderType() === "MARKET"
                    ? "bg-[#2a2a2a] text-white"
                    : "bg-transparent text-[#666666] hover:text-white"
                }`}
              >
                MARKET
              </button>
              <button
                onClick={() => setOrderType("LIMIT")}
                disabled={loading()}
                class={`py-2 text-xs transition-all disabled:opacity-50 ${
                  orderType() === "LIMIT" ? "bg-[#2a2a2a] text-white" : "bg-transparent text-[#666666] hover:text-white"
                }`}
              >
                LIMIT
              </button>
            </div>

            <div class="mb-6">
              <label class="text-xs text-[#666666] mb-2 block">SIZE</label>
              <input
                type="number"
                value={orderSize()}
                onInput={(e) => setOrderSize(e.currentTarget.value)}
                placeholder="0.00"
                disabled={loading()}
                class="w-full bg-[#000000] border border-[#222222] px-4 py-3 text-sm outline-none focus:border-white transition-colors disabled:opacity-50"
              />
            </div>

            <Show when={activeTab() === "crypto"}>
              <div class="mb-6">
                <div class="flex items-center justify-between mb-2">
                  <label class="text-xs text-[#666666]">LEVERAGE</label>
                  <span class="text-sm font-semibold">{leverage()}x</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={leverage()}
                  onInput={(e) => setLeverage(Number.parseInt(e.currentTarget.value))}
                  disabled={loading()}
                  class="w-full h-1 bg-[#222222] appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer disabled:opacity-50"
                />
                <div class="flex justify-between text-xs text-[#666666] mt-1">
                  <span>1x</span>
                  <span>10x</span>
                </div>
              </div>
            </Show>

            <Show when={orderType() === "LIMIT"}>
              <div class="mb-6">
                <label class="text-xs text-[#666666] mb-2 block">LIMIT PRICE</label>
                <input
                  type="number"
                  value={limitPrice()}
                  onInput={(e) => setLimitPrice(e.currentTarget.value)}
                  placeholder="0.00"
                  disabled={loading()}
                  class="w-full bg-[#000000] border border-[#222222] px-4 py-3 text-sm outline-none focus:border-white transition-colors disabled:opacity-50"
                />
              </div>
            </Show>

            <button
              onClick={handlePlaceOrder}
              disabled={!orderSize() || (orderType() === "LIMIT" && !limitPrice()) || loading()}
              class="w-full py-4 bg-white text-black font-semibold text-sm hover:bg-[#aaaaaa] disabled:bg-[#222222] disabled:text-[#666666] disabled:cursor-not-allowed transition-colors"
            >
              {loading() ? "PROCESSING..." : "PLACE ORDER"}
            </button>

            <div class="mt-6 pt-6 border-t border-[#222222] space-y-2 text-xs">
              <div class="flex justify-between">
                <span class="text-[#666666]">Est. Total</span>
                <span>
                  {orderSize()
                    ? `${(Number.parseFloat(orderSize()) * selectedMarket().price).toLocaleString("en-US")}`
                    : "$0.00"}
                </span>
              </div>
              <Show when={activeTab() === "crypto" && leverage() > 1}>
                <div class="flex justify-between">
                  <span class="text-[#666666]">Margin Required</span>
                  <span>
                    $
                    {((Number.parseFloat(orderSize() || "0") * selectedMarket().price) / leverage()).toLocaleString(
                      "en-US",
                    )}
                  </span>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default Trade
