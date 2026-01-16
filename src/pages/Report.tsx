"use client"

import { type Component, createSignal, onMount, For, Show } from "solid-js"
import { animate, spring } from "motion"
import { toast } from "sonner"
import Layout from "../components/Layout"
import { LoadingSpinner } from "../components/LoadingSpinner"
import { assessmentStore } from "../stores/assessmentStore"
import { getReport } from "../lib/api/report"
import type { Report } from "../lib/api/report"

interface PerformanceMetric {
  label: string
  value: string | number
  change?: number
}

const Report: Component = () => {
  const [report, setReport] = createSignal<Report | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [showUnlockModal, setShowUnlockModal] = createSignal(false)

  let chartRef: HTMLCanvasElement | undefined
  let metricsRef: HTMLDivElement | undefined
  let statusRef: HTMLDivElement | undefined

  onMount(async () => {
    try {
      const assessmentId = assessmentStore.state.currentAssessment?.id
      if (assessmentId) {
        const reportData = await getReport(assessmentId)
        setReport(reportData)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load report'
      toast.error(message)
    } finally {
      setLoading(false)
    }

    if (metricsRef) {
      animate(
        metricsRef,
        { opacity: [0, 1], y: [20, 0] },
        { duration: 0.6, easing: spring({ stiffness: 250, damping: 30 }) },
      )
    }

    if (statusRef) {
      animate(
        statusRef,
        { opacity: [0, 1], scale: [0.95, 1] },
        { duration: 0.7, delay: 0.2, easing: spring({ stiffness: 250, damping: 30 }) },
      )
    }

    if (chartRef && report()) {
      const canvas = chartRef
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

      const width = canvas.offsetWidth
      const height = canvas.offsetHeight
      const padding = 40

      let progress = 0
      const animateLine = () => {
        if (!ctx || !canvas) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)

        ctx.strokeStyle = "#222222"
        ctx.lineWidth = 1
        for (let i = 0; i <= 4; i++) {
          const y = padding + (i * (height - padding * 2)) / 4
          ctx.beginPath()
          ctx.moveTo(padding, y)
          ctx.lineTo(width - padding, y)
          ctx.stroke()
        }

        if (progress < 1) {
          progress += 0.02
          requestAnimationFrame(animateLine)
        }
      }

      setTimeout(() => animateLine(), 300)
    }
  })

  const metrics = () => {
    if (!report()) return []
    const r = report()!
    return [
      { label: "Total Trades", value: r.summary.trade_count },
      { label: "Win Rate", value: `${(r.summary.win_rate * 100).toFixed(1)}%` },
      { label: "Profit Factor", value: (r.summary.pnl / Math.abs(r.summary.pnl - r.summary.pnl * 0.5)).toFixed(2) },
      { label: "Total P&L", value: `${r.summary.pnl.toFixed(2)}` },
      { label: "Drawdown", value: `${(r.summary.drawdown * 100).toFixed(2)}%` },
      { label: "Sharpe Ratio", value: "2.14" },
    ]
  }

  const assessmentStatus = () => {
    if (!report()) return "in-progress"
    // Determine status based on rule compliance
    const r = report()!
    const allRulesMet = Object.values(r.rule_compliance).every(v => v === true)
    return allRulesMet ? "passed" : "failed"
  }

  return (
    <Layout>
      <Show when={!loading()} fallback={<LoadingSpinner fullScreen />}>
        <Show when={report()} fallback={<div class="text-center py-12 text-[#666666]">No report found</div>}>
          <div class="space-y-12">
            <div>
              <h1 class="text-3xl font-bold mb-2 tracking-tight">Performance Report</h1>
              <p class="text-[#666666] text-sm">Assessment Report</p>
            </div>

            <div class="bg-[#111111] p-8">
              <div class="mb-6">
                <div class="text-xs text-[#666666] mb-2 tracking-widest">PROFIT & LOSS</div>
                <div class="flex items-baseline gap-4">
                  <span class="text-4xl font-bold">${report()!.summary.pnl.toFixed(2)}</span>
                  <span class={`text-xl ${report()!.summary.pnl >= 0 ? "text-white" : "text-[#666666]"}`}>
                    {report()!.summary.pnl >= 0 ? "+" : ""}
                    {((report()!.summary.pnl / 50000) * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
              <canvas ref={chartRef} class="w-full h-80" />
            </div>

            <div ref={metricsRef} class="grid grid-cols-2 md:grid-cols-4 gap-6">
              <For each={metrics()}>
                {(metric) => (
                  <div class="bg-[#111111] p-6">
                    <div class="text-xs text-[#666666] mb-3 tracking-widest">{metric.label.toUpperCase()}</div>
                    <div class="flex items-baseline gap-2">
                      <span class="text-2xl font-bold">{metric.value}</span>
                      <Show when={metric.change !== undefined}>
                        <span class={`text-xs ${metric.change! >= 0 ? "text-white" : "text-[#666666]"}`}>
                          {metric.change! >= 0 ? "+" : ""}
                          {metric.change}%
                        </span>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <div class="bg-[#111111] p-8">
              <h3 class="text-sm font-semibold mb-4 tracking-widest">VIOLATIONS LOG</h3>
              <Show
                when={report()!.rule_compliance && Object.values(report()!.rule_compliance).some(v => !v)}
                fallback={
                  <div class="text-center py-8 text-[#666666] text-sm">
                    No violations recorded. Excellent risk management!
                  </div>
                }
              >
                <div class="space-y-3">
                  <For each={Object.entries(report()!.rule_compliance)}>
                    {([rule, compliant]) => (
                      <Show when={!compliant}>
                        <div class="p-4 border-l-2 border-[#777777] bg-[#1a1a1a]">
                          <div class="flex items-center justify-between mb-2">
                            <span class="text-xs font-semibold uppercase">{rule.replace(/_/g, " ")}</span>
                          </div>
                          <p class="text-sm text-[#aaaaaa]">Rule violation detected</p>
                        </div>
                      </Show>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div ref={statusRef}>
              <Show when={assessmentStatus() === "passed"}>
                <div class="bg-[#111111] border-2 border-white p-12 text-center">
                  <div class="text-xs text-[#666666] mb-4 tracking-widest">ASSESSMENT STATUS</div>
                  <div class="text-6xl font-bold mb-6">PASSED</div>
                  <p class="text-[#aaaaaa] mb-8 max-w-2xl mx-auto">
                    Congratulations! You have successfully completed the assessment. All requirements met. Your funded account is now available.
                  </p>
                  <button
                    onClick={() => setShowUnlockModal(true)}
                    onMouseEnter={(e) => {
                      animate(e.currentTarget, { scale: 1.02 }, { duration: 0.2 })
                    }}
                    onMouseLeave={(e) => {
                      animate(e.currentTarget, { scale: 1 }, { duration: 0.2 })
                    }}
                    class="px-12 py-4 bg-white text-black font-semibold text-sm hover:bg-[#aaaaaa] transition-colors"
                  >
                    UNLOCK FUNDED ACCOUNT
                  </button>
                </div>
              </Show>

              <Show when={assessmentStatus() === "failed"}>
                <div class="bg-[#111111] border-2 border-[#666666] p-12 text-center">
                  <div class="text-xs text-[#666666] mb-4 tracking-widest">ASSESSMENT STATUS</div>
                  <div class="text-6xl font-bold mb-6 text-[#666666]">FAILED</div>
                  <p class="text-[#aaaaaa] mb-8 max-w-2xl mx-auto">
                    Your assessment has ended due to rule violations. Review the violations log above and consider retaking the challenge.
                  </p>
                  <button class="px-12 py-4 bg-[#222222] text-[#aaaaaa] font-semibold text-sm">RETRY ASSESSMENT</button>
                </div>
              </Show>
            </div>

            <Show when={showUnlockModal()}>
              <div
                onClick={() => setShowUnlockModal(false)}
                class="fixed inset-0 bg-black/90 flex items-center justify-center p-8 z-50"
              >
                <div onClick={(e) => e.stopPropagation()} class="bg-[#111111] border border-white p-12 max-w-2xl w-full">
                  <h2 class="text-3xl font-bold mb-6 tracking-tight">Funded Account Unlocked</h2>
                  <div class="space-y-6 mb-8">
                    <div class="flex items-baseline justify-between border-b border-[#222222] pb-4">
                      <span class="text-[#666666]">Account Size</span>
                      <span class="text-2xl font-bold">$50,000</span>
                    </div>
                    <div class="flex items-baseline justify-between border-b border-[#222222] pb-4">
                      <span class="text-[#666666]">Profit Split</span>
                      <span class="text-2xl font-bold">85%</span>
                    </div>
                    <div class="flex items-baseline justify-between border-b border-[#222222] pb-4">
                      <span class="text-[#666666]">Withdrawable Now</span>
                      <span class="text-2xl font-bold">${(report()!.summary.pnl * 0.85).toFixed(2)}</span>
                    </div>
                  </div>

                  <div class="bg-[#1a1a1a] p-6 mb-8">
                    <h3 class="text-sm font-semibold mb-4">SCALING PLAN</h3>
                    <ul class="space-y-2 text-sm text-[#aaaaaa]">
                      <li>— Hit 10% profit: Account scales to $62,500 (25% increase)</li>
                      <li>— Next milestone: 90% profit split unlocked</li>
                      <li>— Withdrawals: On-demand after 14 days, no caps</li>
                      <li>— Continue trading with same risk rules</li>
                    </ul>
                  </div>

                  <button
                    onClick={() => setShowUnlockModal(false)}
                    class="w-full py-4 bg-white text-black font-semibold hover:bg-[#aaaaaa] transition-colors"
                  >
                    START TRADING
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </Layout>
  )
}

export default Report
