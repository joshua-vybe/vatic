import { type Component, onMount } from "solid-js"
import TopBar from "./TopBar"
import SymbolBar from "./SymbolBar"
import ChartArea from "./ChartArea"
import OrderBook from "./OrderBook"
import TimeAndSales from "./TimeAndSales"
import OrderEntry from "./OrderEntry"
import BottomPanel from "./BottomPanel"
import { startMarketData } from "../stores/marketDataStore"
import { getCurrentWorkspace } from "../stores/workspaceStore"

const TradingTerminal: Component = () => {
  onMount(() => {
    startMarketData()
  })

  const workspace = getCurrentWorkspace
  const layout = () => workspace()?.layout

  return (
    <div class="flex flex-col h-screen bg-black text-white">
      <TopBar />
      <SymbolBar />

      <div class="flex flex-1 overflow-hidden">
        {/* Main trading area */}
        <div class="flex-1 flex flex-col border-r border-gray-800">{layout()?.showChart && <ChartArea />}</div>

        {/* Right sidebar */}
        <div class="w-80 flex flex-col bg-black">
          {layout()?.showOrderBook && <OrderBook />}
          {layout()?.showTimeAndSales && <TimeAndSales />}
          {layout()?.showOrderEntry && <OrderEntry />}
        </div>
      </div>

      <BottomPanel />
    </div>
  )
}

export default TradingTerminal
