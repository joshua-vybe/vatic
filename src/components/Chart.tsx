"use client"

import { type Component, onMount, onCleanup, createSignal } from "solid-js"

interface ChartProps {
  symbol: string
  type: "crypto" | "polymarket" | "kalshi"
}

const Chart: Component<ChartProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined
  const [indicators, setIndicators] = createSignal({
    sma: false,
    rsi: false,
    macd: false,
  })

  onMount(() => {
    if (!canvasRef) return

    const canvas = canvasRef
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas size
    canvas.width = canvas.offsetWidth * window.devicePixelRatio
    canvas.height = canvas.offsetHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    // Generate mock data
    const dataPoints = 100
    const data: number[] = []
    let basePrice = props.type === "crypto" ? 42000 : 0.5

    for (let i = 0; i < dataPoints; i++) {
      basePrice += (Math.random() - 0.48) * (props.type === "crypto" ? 200 : 0.05)
      data.push(basePrice)
    }

    // Draw chart
    const drawChart = () => {
      if (!ctx || !canvas) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const width = canvas.offsetWidth
      const height = canvas.offsetHeight
      const padding = 40

      const minPrice = Math.min(...data)
      const maxPrice = Math.max(...data)
      const priceRange = maxPrice - minPrice

      // Draw grid
      ctx.strokeStyle = "#222222"
      ctx.lineWidth = 1
      for (let i = 0; i <= 5; i++) {
        const y = padding + (i * (height - padding * 2)) / 5
        ctx.beginPath()
        ctx.moveTo(padding, y)
        ctx.lineTo(width - padding, y)
        ctx.stroke()
      }

      // Draw area fill
      ctx.fillStyle = props.type === "crypto" ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 0.08)"
      ctx.beginPath()
      ctx.moveTo(padding, height - padding)

      data.forEach((price, index) => {
        const x = padding + (index * (width - padding * 2)) / (dataPoints - 1)
        const y = height - padding - ((price - minPrice) / priceRange) * (height - padding * 2)
        if (index === 0) {
          ctx.lineTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })

      ctx.lineTo(width - padding, height - padding)
      ctx.closePath()
      ctx.fill()

      // Draw line
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 2
      ctx.beginPath()

      data.forEach((price, index) => {
        const x = padding + (index * (width - padding * 2)) / (dataPoints - 1)
        const y = height - padding - ((price - minPrice) / priceRange) * (height - padding * 2)
        if (index === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })

      ctx.stroke()

      // Draw price labels
      ctx.fillStyle = "#666666"
      ctx.font = "10px IBM Plex Mono"
      ctx.textAlign = "right"

      for (let i = 0; i <= 5; i++) {
        const price = maxPrice - (i * priceRange) / 5
        const y = padding + (i * (height - padding * 2)) / 5
        const label = props.type === "crypto" ? `$${price.toFixed(0)}` : `${(price * 100).toFixed(1)}%`
        ctx.fillText(label, padding - 10, y + 4)
      }
    }

    drawChart()

    // Handle resize
    const handleResize = () => {
      if (!canvas) return
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
      drawChart()
    }

    window.addEventListener("resize", handleResize)

    onCleanup(() => {
      window.removeEventListener("resize", handleResize)
    })
  })

  return (
    <div class="space-y-4">
      {/* Indicator Toggles */}
      <div class="flex gap-2">
        <button
          onClick={() => setIndicators({ ...indicators(), sma: !indicators().sma })}
          class={`px-3 py-1 text-xs transition-colors ${
            indicators().sma ? "bg-white text-black" : "bg-[#222222] text-[#666666] hover:bg-[#2a2a2a]"
          }`}
        >
          SMA
        </button>
        <button
          onClick={() => setIndicators({ ...indicators(), rsi: !indicators().rsi })}
          class={`px-3 py-1 text-xs transition-colors ${
            indicators().rsi ? "bg-white text-black" : "bg-[#222222] text-[#666666] hover:bg-[#2a2a2a]"
          }`}
        >
          RSI
        </button>
        <button
          onClick={() => setIndicators({ ...indicators(), macd: !indicators().macd })}
          class={`px-3 py-1 text-xs transition-colors ${
            indicators().macd ? "bg-white text-black" : "bg-[#222222] text-[#666666] hover:bg-[#2a2a2a]"
          }`}
        >
          MACD
        </button>
      </div>

      {/* Chart Canvas */}
      <div class="relative w-full h-96">
        <canvas ref={canvasRef} class="w-full h-full" />
      </div>
    </div>
  )
}

export default Chart
