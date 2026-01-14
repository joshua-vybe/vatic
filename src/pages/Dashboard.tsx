"use client"

import type { Component } from "solid-js"
import { appStore } from "../store/appStore"
import Navigation from "../components/Navigation"

interface DashboardProps {
  onNavigate: (page: "dashboard" | "trade" | "report") => void
}

const Dashboard: Component<DashboardProps> = (props) => {
  const challenge = appStore.challenge()
  const profitProgress = (challenge.currentProfit / challenge.profitTarget) * 100
  const daysProgress = (challenge.tradingDays / challenge.minTradingDays) * 100

  return (
    <div style={{ "min-height": "100vh", background: "#000000" }}>
      <Navigation currentPage="dashboard" onNavigate={props.onNavigate} />

      <div style={{ padding: "60px 80px", "max-width": "1600px", margin: "0 auto" }}>
        {/* Balance Display */}
        <div style={{ "margin-bottom": "80px", "text-align": "center" }}>
          <div style={{ "font-size": "14px", color: "#666666", "margin-bottom": "16px", "letter-spacing": "0.1em" }}>
            ACCOUNT BALANCE
          </div>
          <div
            class="pulse"
            style={{
              "font-size": "72px",
              "font-weight": "600",
              color: "#ffffff",
              "margin-bottom": "24px",
              "letter-spacing": "-0.02em",
            }}
          >
            ${appStore.equity().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ "font-size": "18px", color: appStore.dayPnl() >= 0 ? "#ffffff" : "#888888" }}>
            {appStore.dayPnl() >= 0 ? "+" : ""}$
            {appStore.dayPnl().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TODAY
          </div>
        </div>

        {/* Challenge Progress */}
        <div style={{ "margin-bottom": "60px" }}>
          <h2
            style={{
              "font-size": "16px",
              "font-weight": "600",
              "margin-bottom": "32px",
              "letter-spacing": "0.1em",
              color: "#ffffff",
            }}
          >
            PHASE {challenge.phase} PROGRESS
          </h2>
          <div
            style={{ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(300px, 1fr))", gap: "32px" }}
          >
            {/* Profit Target */}
            <div style={{ background: "#111111", padding: "32px" }}>
              <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "20px" }}>
                <span style={{ "font-size": "13px", color: "#888888", "letter-spacing": "0.05em" }}>PROFIT TARGET</span>
                <span style={{ "font-size": "13px", color: "#ffffff" }}>
                  {challenge.currentProfit.toFixed(1)}% / {challenge.profitTarget}%
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "8px",
                  background: "#222222",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(profitProgress, 100)}%`,
                    height: "100%",
                    background: "#ffffff",
                    transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
              </div>
            </div>

            {/* Trading Days */}
            <div style={{ background: "#111111", padding: "32px" }}>
              <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "20px" }}>
                <span style={{ "font-size": "13px", color: "#888888", "letter-spacing": "0.05em" }}>TRADING DAYS</span>
                <span style={{ "font-size": "13px", color: "#ffffff" }}>
                  {challenge.tradingDays} / {challenge.minTradingDays}
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "8px",
                  background: "#222222",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(daysProgress, 100)}%`,
                    height: "100%",
                    background: "#ffffff",
                    transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
              </div>
            </div>

            {/* Drawdown */}
            <div style={{ background: "#111111", padding: "32px" }}>
              <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "20px" }}>
                <span style={{ "font-size": "13px", color: "#888888", "letter-spacing": "0.05em" }}>
                  CURRENT DRAWDOWN
                </span>
                <span style={{ "font-size": "13px", color: "#ffffff" }}>
                  {challenge.currentDrawdown.toFixed(1)}% / {challenge.maxDrawdown}%
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "8px",
                  background: "#222222",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${(challenge.currentDrawdown / challenge.maxDrawdown) * 100}%`,
                    height: "100%",
                    background: "#666666",
                    transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Rules Compliance */}
        <div style={{ "margin-bottom": "60px" }}>
          <h2
            style={{
              "font-size": "16px",
              "font-weight": "600",
              "margin-bottom": "32px",
              "letter-spacing": "0.1em",
              color: "#ffffff",
            }}
          >
            RULES COMPLIANCE
          </h2>
          <div style={{ background: "#111111", padding: "40px" }}>
            <div style={{ display: "grid", gap: "24px" }}>
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                  "padding-bottom": "24px",
                  "border-bottom": "1px solid #222222",
                }}
              >
                <span style={{ "font-size": "14px", color: "#888888" }}>Maximum Daily Loss (5%)</span>
                <span style={{ "font-size": "14px", color: "#ffffff" }}>✓ COMPLIANT</span>
              </div>
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                  "padding-bottom": "24px",
                  "border-bottom": "1px solid #222222",
                }}
              >
                <span style={{ "font-size": "14px", color: "#888888" }}>Maximum Overall Drawdown (10%)</span>
                <span style={{ "font-size": "14px", color: "#ffffff" }}>✓ COMPLIANT</span>
              </div>
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                  "padding-bottom": "24px",
                  "border-bottom": "1px solid #222222",
                }}
              >
                <span style={{ "font-size": "14px", color: "#888888" }}>Minimum Trading Days (10)</span>
                <span style={{ "font-size": "14px", color: "#666666" }}>IN PROGRESS</span>
              </div>
              <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                <span style={{ "font-size": "14px", color: "#888888" }}>Maximum Risk per Trade (2%)</span>
                <span style={{ "font-size": "14px", color: "#ffffff" }}>✓ COMPLIANT</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div style={{ "text-align": "center" }}>
          <button
            onClick={() => props.onNavigate("trade")}
            style={{
              padding: "20px 60px",
              background: "#ffffff",
              color: "#000000",
              border: "none",
              "font-size": "14px",
              "font-weight": "600",
              "letter-spacing": "0.1em",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#eeeeee"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#ffffff"
            }}
          >
            START TRADING
          </button>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
