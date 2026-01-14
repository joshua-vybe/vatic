"use client"

import { type Component, createSignal } from "solid-js"
import { animate, spring } from "motion"

interface LoginProps {
  onLogin: () => void
}

const tiers = [
  { name: "Starter", price: 99, target: "5%", capital: "$10,000" },
  { name: "Standard", price: 199, target: "8%", capital: "$25,000" },
  { name: "Advanced", price: 349, target: "8%", capital: "$50,000" },
  { name: "Professional", price: 499, target: "10%", capital: "$100,000" },
]

const Login: Component<LoginProps> = (props) => {
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [selectedTier, setSelectedTier] = createSignal(1)
  const [focusedField, setFocusedField] = createSignal<string | null>(null)

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    props.onLogin()
  }

  const handleTierHover = (index: number, el: HTMLElement) => {
    animate(el, { scale: 1.05, y: -8 }, { duration: 0.3, easing: spring({ stiffness: 250, damping: 30 }) })
  }

  const handleTierLeave = (el: HTMLElement) => {
    animate(el, { scale: 1, y: 0 }, { duration: 0.3, easing: spring({ stiffness: 250, damping: 30 }) })
  }

  return (
    <div
      style={{
        "min-height": "100vh",
        background: "#000000",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        padding: "40px 20px",
      }}
    >
      <div style={{ "max-width": "1200px", width: "100%", display: "flex", "flex-direction": "column", gap: "80px" }}>
        {/* Header */}
        <div style={{ "text-align": "center" }}>
          <h1
            style={{
              "font-size": "48px",
              "font-weight": "600",
              color: "#ffffff",
              "margin-bottom": "16px",
              "letter-spacing": "-0.02em",
            }}
          >
            VATIC PROP
          </h1>
          <p style={{ "font-size": "16px", color: "#888888", "letter-spacing": "0.05em" }}>
            PROFESSIONAL TRADING ASSESSMENT
          </p>
        </div>

        {/* Login Form */}
        <div
          style={{
            background: "#111111",
            padding: "60px",
            "border-radius": "0px",
            "max-width": "480px",
            width: "100%",
            margin: "0 auto",
          }}
        >
          <h2
            style={{
              "font-size": "24px",
              "font-weight": "600",
              "margin-bottom": "40px",
              color: "#ffffff",
              "text-align": "center",
            }}
          >
            Sign In
          </h2>

          <form onSubmit={handleSubmit} style={{ display: "flex", "flex-direction": "column", gap: "32px" }}>
            <div style={{ position: "relative" }}>
              <label
                style={{
                  position: "absolute",
                  left: "0",
                  top: focusedField() === "email" || email() ? "-20px" : "16px",
                  "font-size": focusedField() === "email" || email() ? "12px" : "14px",
                  color: focusedField() === "email" ? "#ffffff" : "#666666",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  "pointer-events": "none",
                }}
              >
                Email Address
              </label>
              <input
                type="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                style={{
                  width: "100%",
                  padding: "16px 0",
                  background: "transparent",
                  border: "none",
                  "border-bottom": `1px solid ${focusedField() === "email" ? "#ffffff" : "#333333"}`,
                  color: "#ffffff",
                  "font-size": "14px",
                  transition: "border-color 0.3s ease",
                }}
              />
            </div>

            <div style={{ position: "relative" }}>
              <label
                style={{
                  position: "absolute",
                  left: "0",
                  top: focusedField() === "password" || password() ? "-20px" : "16px",
                  "font-size": focusedField() === "password" || password() ? "12px" : "14px",
                  color: focusedField() === "password" ? "#ffffff" : "#666666",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  "pointer-events": "none",
                }}
              >
                Password
              </label>
              <input
                type="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                style={{
                  width: "100%",
                  padding: "16px 0",
                  background: "transparent",
                  border: "none",
                  "border-bottom": `1px solid ${focusedField() === "password" ? "#ffffff" : "#333333"}`,
                  color: "#ffffff",
                  "font-size": "14px",
                  transition: "border-color 0.3s ease",
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                width: "100%",
                padding: "18px",
                background: "#ffffff",
                color: "#000000",
                border: "none",
                "font-size": "14px",
                "font-weight": "600",
                "margin-top": "16px",
                "letter-spacing": "0.05em",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#eeeeee"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#ffffff"
              }}
            >
              CONTINUE
            </button>
          </form>
        </div>

        {/* Challenge Tiers */}
        <div>
          <h3
            style={{
              "font-size": "20px",
              "font-weight": "600",
              "text-align": "center",
              "margin-bottom": "40px",
              color: "#ffffff",
              "letter-spacing": "0.05em",
            }}
          >
            SELECT YOUR CHALLENGE
          </h3>
          <div
            style={{
              display: "grid",
              "grid-template-columns": "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "24px",
            }}
          >
            {tiers.map((tier, index) => (
              <div
                key={tier.name} // Added key property
                ref={(el) => {
                  el.addEventListener("mouseenter", () => handleTierHover(index, el))
                  el.addEventListener("mouseleave", () => handleTierLeave(el))
                }}
                onClick={() => setSelectedTier(index)}
                style={{
                  background: selectedTier() === index ? "#222222" : "#111111",
                  padding: "40px 32px",
                  cursor: "pointer",
                  border: `1px solid ${selectedTier() === index ? "#444444" : "#222222"}`,
                  transition: "border-color 0.3s ease",
                }}
              >
                <div style={{ "margin-bottom": "24px" }}>
                  <div
                    style={{
                      "font-size": "14px",
                      color: "#888888",
                      "margin-bottom": "8px",
                      "letter-spacing": "0.05em",
                    }}
                  >
                    {tier.name.toUpperCase()}
                  </div>
                  <div style={{ "font-size": "36px", "font-weight": "600", color: "#ffffff", "margin-bottom": "4px" }}>
                    ${tier.price}
                  </div>
                  <div style={{ "font-size": "12px", color: "#666666" }}>ONE-TIME FEE</div>
                </div>
                <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
                  <div style={{ display: "flex", "justify-content": "space-between", "font-size": "13px" }}>
                    <span style={{ color: "#888888" }}>Starting Capital</span>
                    <span style={{ color: "#ffffff" }}>{tier.capital}</span>
                  </div>
                  <div style={{ display: "flex", "justify-content": "space-between", "font-size": "13px" }}>
                    <span style={{ color: "#888888" }}>Profit Target</span>
                    <span style={{ color: "#ffffff" }}>{tier.target}</span>
                  </div>
                  <div style={{ display: "flex", "justify-content": "space-between", "font-size": "13px" }}>
                    <span style={{ color: "#888888" }}>Max Drawdown</span>
                    <span style={{ color: "#ffffff" }}>10%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
