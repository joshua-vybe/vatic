import { type Component, lazy, Suspense, createEffect, onCleanup } from "solid-js"
import { Router, Route } from "@solidjs/router"
import { authStore } from "./stores/authStore"
import { websocket } from "./lib/socket"
import { assessmentStore } from "./stores/assessmentStore"
import { marketDataStore } from "./stores/marketDataStore"
import { tradingStore } from "./stores/tradingStore"
import { rulesStore } from "./stores/rulesStore"
import { ProtectedRoute } from "./lib/auth-guard"
import { WebSocketMessage } from "./lib/websocket-types"

const Login = lazy(() => import("./pages/Login"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Trade = lazy(() => import("./pages/Trade"))
const Report = lazy(() => import("./pages/Report"))

const App: Component = () => {
  // Initialize WebSocket connection when authenticated
  createEffect(() => {
    if (authStore.state.isAuthenticated && authStore.state.token) {
      websocket.connect(authStore.state.token).catch(error => {
        console.error("Failed to connect WebSocket:", error)
      })

      // Set up global message handlers
      const unsubscribeMessage = websocket.onMessage((message: WebSocketMessage) => {
        switch (message.type) {
          case 'market_price':
            marketDataStore.updatePrice(message.market, message.price)
            break
          case 'pnl_update':
            // Preserve existing assessment data, only update mutable fields
            const currentAssessment = assessmentStore.state.currentAssessment
            if (currentAssessment && currentAssessment.id === message.assessment_id) {
              assessmentStore.updateFromWebSocket({
                ...currentAssessment,
                balance: message.balance,
                peak_balance: message.peak_balance,
              })
            }
            tradingStore.updatePositionsFromWebSocket(message.positions)
            break
          case 'rule_status':
            rulesStore.updateRuleStatus(message.rules)
            break
          case 'violation':
            rulesStore.addViolation(message.violation)
            break
        }
      })

      onCleanup(() => {
        unsubscribeMessage()
      })
    } else {
      websocket.disconnect()
    }
  })

  // Disconnect WebSocket on logout
  createEffect(() => {
    if (!authStore.state.isAuthenticated) {
      websocket.disconnect()
    }
  })

  return (
    <Suspense fallback={<div class="min-h-screen bg-[#000000]" />}>
      <Router>
        <Route path="/" component={Login} />
        <Route path="/login" component={Login} />
        <Route path="/dashboard" component={() => (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        )} />
        <Route path="/trade" component={() => (
          <ProtectedRoute>
            <Trade />
          </ProtectedRoute>
        )} />
        <Route path="/report" component={() => (
          <ProtectedRoute>
            <Report />
          </ProtectedRoute>
        )} />
      </Router>
    </Suspense>
  )
}

export default App
