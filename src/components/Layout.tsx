import { type Component, type JSX, onMount } from "solid-js"
import { A } from "@solidjs/router"
import { fadeIn } from "../lib/motion"

interface LayoutProps {
  children: JSX.Element
}

const Layout: Component<LayoutProps> = (props) => {
  let navRef: HTMLElement | undefined

  onMount(() => {
    if (navRef) fadeIn(navRef)
  })

  return (
    <div class="min-h-screen bg-[#000000] text-white">
      <nav ref={navRef} class="border-b border-[#222222] bg-[#000000]">
        <div class="max-w-screen-2xl mx-auto px-8 py-6">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-12">
              <A href="/dashboard" class="text-xl font-semibold tracking-tight hover:text-[#aaaaaa] transition-colors">
                VATIC PROP
              </A>
              <div class="flex gap-8 text-sm">
                <A
                  href="/dashboard"
                  class="hover:text-[#aaaaaa] transition-colors"
                  activeClass="text-white"
                  inactiveClass="text-[#666666]"
                >
                  Dashboard
                </A>
                <A
                  href="/trade"
                  class="hover:text-[#aaaaaa] transition-colors"
                  activeClass="text-white"
                  inactiveClass="text-[#666666]"
                >
                  Trade
                </A>
                <A
                  href="/report"
                  class="hover:text-[#aaaaaa] transition-colors"
                  activeClass="text-white"
                  inactiveClass="text-[#666666]"
                >
                  Report
                </A>
              </div>
            </div>
            <div class="flex items-center gap-6 text-sm text-[#666666]">
              <div class="px-4 py-2 bg-[#111111] hover:bg-[#1a1a1a] transition-colors cursor-pointer">Account</div>
            </div>
          </div>
        </div>
      </nav>
      <main class="max-w-screen-2xl mx-auto px-8 py-12">{props.children}</main>
    </div>
  )
}

export default Layout
