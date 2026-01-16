"use client"

import { type Component, createSignal, onMount, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { animate, spring } from "motion"
import { toast } from "sonner"
import { authStore } from "../stores/authStore"
import { getTiers, createPurchase } from "../lib/api/payment"
import { LoadingSpinner } from "../components/LoadingSpinner"
import type { Tier } from "../types"

const Login: Component = () => {
  const navigate = useNavigate()
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [selectedTier, setSelectedTier] = createSignal<string | null>(null)
  const [emailFocused, setEmailFocused] = createSignal(false)
  const [passwordFocused, setPasswordFocused] = createSignal(false)
  const [tiers, setTiers] = createSignal<Tier[]>([])
  const [loading, setLoading] = createSignal(false)
  const [tiersLoading, setTiersLoading] = createSignal(true)

  let formRef: HTMLDivElement | undefined
  let tiersRef: HTMLDivElement | undefined

  onMount(async () => {
    // Fetch tiers on mount
    try {
      const fetchedTiers = await getTiers()
      setTiers(fetchedTiers)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load tiers'
      toast.error(message)
    } finally {
      setTiersLoading(false)
    }

    if (formRef) {
      animate(
        formRef,
        { opacity: [0, 1], y: [20, 0] },
        { duration: 0.6, easing: spring({ stiffness: 250, damping: 30 }) },
      )
    }
    if (tiersRef) {
      animate(
        tiersRef,
        { opacity: [0, 1], y: [20, 0] },
        { duration: 0.6, delay: 0.2, easing: spring({ stiffness: 250, damping: 30 }) },
      )
    }
  })

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (!email() || !password() || !selectedTier()) {
      toast.error("Please fill in all fields")
      return
    }

    setLoading(true)
    try {
      // Login
      await authStore.login(email(), password())
      
      // Create purchase
      const purchase = await createPurchase(selectedTier()!)
      
      // Handle checkout if URL is provided
      if (purchase.stripe_session_id) {
        // Redirect to Stripe checkout
        window.location.href = `https://checkout.stripe.com/pay/${purchase.stripe_session_id}`
        return
      }
      
      // If no checkout needed, navigate to dashboard
      navigate("/dashboard")
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const handleTierSelect = (tierId: string) => {
    setSelectedTier(tierId)
  }

  return (
    <div class="min-h-screen bg-[#000000] flex items-center justify-center p-8">
      <div class="w-full max-w-6xl">
        {/* Header */}
        <div ref={formRef} class="text-center mb-16">
          <h1 class="text-5xl font-bold mb-4 tracking-tight">VATIC PROP</h1>
          <p class="text-[#aaaaaa] text-sm">Elite Prop Trading Assessment Platform</p>
        </div>

        {/* Login Form */}
        <div ref={formRef} class="max-w-md mx-auto mb-20">
          <form onSubmit={handleSubmit} class="space-y-8">
            {/* Email Input */}
            <div class="relative">
              <input
                type="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                class="w-full bg-[#111111] border-b border-[#222222] px-0 py-4 text-white outline-none focus:border-white transition-all"
                required
                disabled={loading()}
              />
              <label
                class={`absolute left-0 transition-all duration-300 pointer-events-none ${
                  emailFocused() || email() ? "text-xs text-[#aaaaaa] -top-5" : "text-sm text-[#666666] top-4"
                }`}
              >
                Email Address
              </label>
            </div>

            {/* Password Input */}
            <div class="relative">
              <input
                type="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                class="w-full bg-[#111111] border-b border-[#222222] px-0 py-4 text-white outline-none focus:border-white transition-all"
                required
                disabled={loading()}
              />
              <label
                class={`absolute left-0 transition-all duration-300 pointer-events-none ${
                  passwordFocused() || password() ? "text-xs text-[#aaaaaa] -top-5" : "text-sm text-[#666666] top-4"
                }`}
              >
                Password
              </label>
            </div>
          </form>
        </div>

        {/* Tier Selection */}
        <div ref={tiersRef}>
          <h2 class="text-2xl font-semibold text-center mb-12 tracking-tight">Select Your Challenge</h2>
          <Show when={!tiersLoading()} fallback={<LoadingSpinner />}>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <For each={tiers()}>
                {(tier) => (
                  <div
                    onClick={() => handleTierSelect(tier.id)}
                    onMouseEnter={(e) => {
                      animate(
                        e.currentTarget,
                        { scale: 1.02, y: -4 },
                        { duration: 0.3, easing: spring({ stiffness: 250, damping: 30 }) },
                      )
                    }}
                    onMouseLeave={(e) => {
                      animate(
                        e.currentTarget,
                        { scale: 1, y: 0 },
                        { duration: 0.3, easing: spring({ stiffness: 250, damping: 30 }) },
                      )
                    }}
                    class={`bg-[#111111] p-8 cursor-pointer transition-all ${
                      selectedTier() === tier.id ? "border-2 border-white" : "border border-[#222222]"
                    }`}
                  >
                    <div class="mb-6">
                      <h3 class="text-xs font-semibold text-[#aaaaaa] mb-2 tracking-widest">{tier.name}</h3>
                      <div class="flex items-baseline gap-1">
                        <span class="text-4xl font-bold">${tier.price}</span>
                        <span class="text-[#666666] text-sm">USD</span>
                      </div>
                    </div>
                    <ul class="space-y-3">
                      <li class="text-sm text-[#aaaaaa] flex items-start gap-2">
                        <span class="text-white mt-1">—</span>
                        <span>${tier.account_size.toLocaleString()} Account</span>
                      </li>
                      <li class="text-sm text-[#aaaaaa] flex items-start gap-2">
                        <span class="text-white mt-1">—</span>
                        <span>{tier.profit_split}% Profit Split</span>
                      </li>
                      <li class="text-sm text-[#aaaaaa] flex items-start gap-2">
                        <span class="text-white mt-1">—</span>
                        <span>8% Phase 1 Target</span>
                      </li>
                      <li class="text-sm text-[#aaaaaa] flex items-start gap-2">
                        <span class="text-white mt-1">—</span>
                        <span>5% Phase 2 Target</span>
                      </li>
                    </ul>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Submit Button */}
          <div class="mt-12 text-center">
            <button
              onClick={handleSubmit}
              disabled={!email() || !password() || !selectedTier() || loading()}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  animate(e.currentTarget, { scale: 1.02 }, { duration: 0.2 })
                }
              }}
              onMouseLeave={(e) => {
                animate(e.currentTarget, { scale: 1 }, { duration: 0.2 })
              }}
              class="px-16 py-4 bg-white text-black font-semibold text-sm tracking-wide hover:bg-[#aaaaaa] disabled:bg-[#222222] disabled:text-[#666666] disabled:cursor-not-allowed transition-colors"
            >
              {loading() ? "PROCESSING..." : "START ASSESSMENT"}
            </button>
            <p class="text-xs text-[#666666] mt-6">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
