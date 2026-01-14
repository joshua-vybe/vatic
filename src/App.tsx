import { type Component, createSignal } from "solid-js"
import Login from "./pages/Login"
import Dashboard from "./pages/Dashboard"
import Trade from "./pages/Trade"
import Report from "./pages/Report"

const App: Component = () => {
  const [currentPage, setCurrentPage] = createSignal<"login" | "dashboard" | "trade" | "report">("login")
  const [isAuthenticated, setIsAuthenticated] = createSignal(false)

  const handleLogin = () => {
    setIsAuthenticated(true)
    setCurrentPage("dashboard")
  }

  const navigate = (page: "dashboard" | "trade" | "report") => {
    if (isAuthenticated()) {
      setCurrentPage(page)
    }
  }

  return (
    <>
      {!isAuthenticated() && <Login onLogin={handleLogin} />}
      {isAuthenticated() && currentPage() === "dashboard" && <Dashboard onNavigate={navigate} />}
      {isAuthenticated() && currentPage() === "trade" && <Trade onNavigate={navigate} />}
      {isAuthenticated() && currentPage() === "report" && <Report onNavigate={navigate} />}
    </>
  )
}

export default App
