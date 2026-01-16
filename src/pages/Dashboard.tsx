"use client"

import { type Component, createSignal, onMount, Show, createEffect } from "solid-js"
import { animate, spring } from "motion"
import { toast } from "sonner"
import Layout from "../components/Layout"
import { LoadingSpinner } from "../components/LoadingSpinner"
import { assessmentStore } from "../stores/assessmentStore"
import { rulesStore } from "../stores/rulesStore"
import { appStore } from "../stores/appStore"
import { websocket } from "../lib/socket"
import { useParams } from "@solidjs/router"
import type { Assessment } from "../types"

const Dashboard: Component = () => {
  const params = useParams()
  const [showRulesModal, setShowRulesModal] = createSignal(false)
  const [loading, setLoading] = createSignal(true)

  let balanceRef: HTMLDivElement | undefined
  let gaugesRef: HTMLDivElement | undefined
  let progressRef: HTMLDivElement | undefined

  onMount(async () => {
    try {
      // Fetch assessments first
      await assessmentStore.fetchAssessments()
      
      // Get assessment ID from URL or use first assessment
      const assessmentId = params.id || assessmentStore.state.assessments[0]?.id
      
      if (assessmentId) {
        await assessmentStore.selectAssessment(assessmentId)
        websocket.subscribe(assessmentId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load assessment'
      toast.error(message)
    } finally {
      setLoading(false)
    }

    if (balanceRef) {
      animate(
        balanceRef,
        { opacity: [0, 1], y: [20, 0] },
        { duration: 0.6, easing: spring({ stiffness: 250, damping: 30 }) },
      )
      animate(balanceRef, { scale: [1, 1.005, 1] }, { duration: 2, repeat: Number.POSITIVE_INFINITY })
    }
    if (gaugesRef) {
      animate(
        gaugesRef,
        { opacity: [0, 1], y: [20, 0] },
        { duration: 0.6, delay: 0.15, easing: spring({ stiffness: 250, damping: 30 }) },
      )
    }
    if (progressRef) {
      animate(
        progressRef,
        { opacity: [0, 1], y: [20, 0] },
        { duration: 0.6, delay: 0.3, easing: spring({ stiffness: 250, damping: 30 }) },
      )
    }
  })

  const challenge = () => assessmentStore.state.currentAssessment

  const pnl = () => appStore.getPnL()
  const pnlPercent = () => appStore.getPnLPercent()
  const profitProgress = () => appStore.getProfitProgress()
  const daysProgress = () => appStore.getDaysProgress()

  const dailyLoss = () => rulesStore.state.ruleStatus?.daily_loss.value || 0
  const dailyLossPercent = () => challenge() ? (dailyLoss() / challenge()!.starting_balance) * 100 : 0

  const drawdown = () => rulesStore.state.ruleStatus?.max_drawdown.value || 0
  const drawdownPercent = () => challenge() ? (drawdown() / challenge()!.starting_balance) * 100 : 0

  return (
    <Layout>
      <Show when={!loading()} fallback={<LoadingSpinner fullScreen />}>
        <Show when={challenge()} fallback={<div class="text-center py-12 text-[#666666]">No assessment found</div>}>
          <div class="space-y-12">
            {/* Balance Display */}
            <div ref={balanceRef} class="text-center py-12">
              <div class="text-xs text-[#666666] mb-2 tracking-widest">ACCOUNT BALANCE</div>
              <div class="text-7xl font-bold mb-4">
                ${appStore.getBalance().toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div class={`text-2xl ${pnl() >= 0 ? "text-white" : "text-[#666666]"}`}>
                {pnl() >= 0 ? "+" : ""}${pnl().toLocaleString("en-US", { minimumFractionDigits: 2 })} (
                {pnlPercent().toFixed(2)}%)
              </div>
            </div>

            {/* Gauges */}
            <div ref={gaugesRef} class="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Daily Loss Gauge */}
              <div class="bg-[#111111] p-8">
                <div class="text-xs text-[#666666] mb-6 tracking-widest">DAILY LOSS</div>
                <CircularProgress
                  value={dailyLossPercent()}
                  max={5}
                  label={`${dailyLossPercent().toFixed(2)}%`}
                  sublabel="/ 5% MAX"
                />
              </div>

              {/* Drawdown Gauge */}
              <div class="bg-[#111111] p-8">
                <div class="text-xs text-[#666666] mb-6 tracking-widest">DRAWDOWN</div>
                <CircularProgress
                  value={drawdownPercent()}
                  max={10}
                  label={`${drawdownPercent().toFixed(2)}%`}
                  sublabel="/ 10% MAX"
                />
              </div>

              {/* Profit Target Gauge */}
              <div class="bg-[#111111] p-8">
                <div class="text-xs text-[#666666] mb-6 tracking-widest">PROFIT TARGET</div>
                <CircularProgress
                  value={pnlPercent()}
                  max={8}
                  label={`${pnlPercent().toFixed(2)}%`}
                  sublabel="/ 8% TARGET"
                  inverse
                />
              </div>
            </div>

            {/* Phase Tracker */}
            <div ref={progressRef} class="bg-[#111111] p-8">
              <div class="flex items-center justify-between mb-8">
                <h2 class="text-lg font-semibold tracking-tight">Assessment Progress</h2>
                <button
                  onClick={() => setShowRulesModal(true)}
                  class="text-xs text-[#aaaaaa] hover:text-white transition-colors"
                >
                  VIEW RULES
                </button>
              </div>

              <div class="space-y-8">
                {/* Phase Indicator */}
                <div>
                  <div class="text-xs text-[#666666] mb-3 tracking-widest">CURRENT STATUS</div>
                  <div class="flex gap-4">
                    <div
                      class={`px-6 py-3 ${challenge()!.status === 'active' ? "bg-white text-black" : "bg-[#222222] text-[#666666]"}`}
                    >
                      {challenge()!.status.toUpperCase()}
                    </div>
                  </div>
                </div>

                {/* Progress Bars */}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <div class="flex items-center justify-between mb-3">
                      <span class="text-xs text-[#666666] tracking-widest">PROFIT PROGRESS</span>
                      <span class="text-sm">{Math.min(profitProgress(), 100).toFixed(0)}%</span>
                    </div>
                    <div class="h-1 bg-[#222222] relative overflow-hidden">
                      <div
                        class="absolute inset-y-0 left-0 bg-white transition-all duration-500"
                        style={{ width: `${Math.min(profitProgress(), 100)}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div class="flex items-center justify-between mb-3">
                      <span class="text-xs text-[#666666] tracking-widest">TRADING DAYS</span>
                      <span class="text-sm">
                        {Math.floor(daysProgress())} / 10
                      </span>
                    </div>
                    <div class="h-1 bg-[#222222] relative overflow-hidden">
                      <div
                        class="absolute inset-y-0 left-0 bg-white transition-all duration-500"
                        style={{ width: `${Math.min(daysProgress(), 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div class="grid grid-cols-2 md:grid-cols-4 gap-6 pt-6 border-t border-[#222222]">
                  <div>
                    <div class="text-xs text-[#666666] mb-1">VIOLATIONS</div>
                    <div class="text-2xl font-semibold">{rulesStore.state.violations.length}</div>
                  </div>
                  <div>
                    <div class="text-xs text-[#666666] mb-1">ACCOUNT SIZE</div>
                    <div class="text-2xl font-semibold">${(challenge()!.starting_balance / 1000).toFixed(0)}K</div>
                  </div>
                  <div>
                    <div class="text-xs text-[#666666] mb-1">STATUS</div>
                    <div class="text-2xl font-semibold uppercase">{challenge()!.status}</div>
                  </div>
                  <div>
                    <div class="text-xs text-[#666666] mb-1">PEAK BALANCE</div>
                    <div class="text-2xl font-semibold">${challenge()!.peak_balance.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Rules Modal */}
            <Show when={showRulesModal()}>
              <div
                onClick={() => setShowRulesModal(false)}
                class="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-50"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  class="bg-[#111111] border border-[#222222] p-12 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
                >
                  <h2 class="text-2xl font-semibold mb-8 tracking-tight">Challenge Rules</h2>
                  <div class="space-y-6 text-sm">
                    <div>
                      <h3 class="text-white font-semibold mb-2">Phase 1 Requirements</h3>
                      <ul class="space-y-2 text-[#aaaaaa]">
                        <li>— Profit Target: 8% of starting balance</li>
                        <li>— Minimum Trading Days: 10 days</li>
                        <li>— Daily Loss Limit: 5% maximum</li>
                        <li>— Overall Drawdown: 10% maximum</li>
                        <li>— Risk Per Trade: 2% maximum</li>
                        <li>— Minimum Trades: 30 total trades</li>
                      </ul>
                    </div>
                    <div>
                      <h3 class="text-white font-semibold mb-2">Phase 2 Requirements</h3>
                      <ul class="space-y-2 text-[#aaaaaa]">
                        <li>— Profit Target: 5% of starting balance</li>
                        <li>— Minimum Trading Days: 10 days</li>
                        <li>— Daily Loss Limit: 5% maximum</li>
                        <li>— Overall Drawdown: 10% maximum</li>
                        <li>— Risk Per Trade: 2% maximum</li>
                      </ul>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowRulesModal(false)}
                    class="mt-8 w-full py-3 bg-white text-black font-semibold hover:bg-[#aaaaaa] transition-colors"
                  >
                    CLOSE
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

interface CircularProgressProps {
  value: number
  max: number
  label: string
  sublabel: string
  inverse?: boolean
}

const CircularProgress: Component<CircularProgressProps> = (props) => {
  const percentage = () => (props.value / props.max) * 100
  const circumference = 2 * Math.PI * 45
  const offset = () => circumference - (percentage() / 100) * circumference

  const color = () => {
    if (props.inverse) return "#ffffff"
    return percentage() >= 90 ? "#777777" : percentage() >= 70 ? "#999999" : "#ffffff"
  }

  return (
    <div class="flex flex-col items-center">
      <div class="relative w-32 h-32">
        <svg class="w-full h-full transform -rotate-90">
          <circle cx="64" cy="64" r="45" stroke="#222222" strokeWidth="8" fill="none" />
          <circle
            cx="64"
            cy="64"
            r="45"
            stroke={color()}
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset()}
            class="transition-all duration-500"
          />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="text-center">
            <div class="text-xl font-bold">{props.label}</div>
          </div>
        </div>
      </div>
      <div class="text-xs text-[#666666] mt-4">{props.sublabel}</div>
    </div>
  )
}

export default Dashboard
