"use client"

import type { Component } from "solid-js"

interface NavigationProps {
  currentPage: "dashboard" | "trade" | "report"
  onNavigate: (page: "dashboard" | "trade" | "report") => void
}

const Navigation: Component<NavigationProps> = (props) => {
  return (
    <nav
      style={{
        background: "#111111",
        padding: "20px 40px",
        display: "flex",
        "justify-content": "space-between",
        "align-items": "center",
        "border-bottom": "1px solid #222222",
      }}
    >
      <div style={{ "font-size": "18px", "font-weight": "600", "letter-spacing": "0.05em", color: "#ffffff" }}>
        VATIC PROP
      </div>
      <div style={{ display: "flex", gap: "40px" }}>
        <button
          onClick={() => props.onNavigate("dashboard")}
          style={{
            background: "transparent",
            border: "none",
            "font-size": "13px",
            color: props.currentPage === "dashboard" ? "#ffffff" : "#666666",
            "letter-spacing": "0.05em",
            transition: "color 0.3s ease",
          }}
        >
          DASHBOARD
        </button>
        <button
          onClick={() => props.onNavigate("trade")}
          style={{
            background: "transparent",
            border: "none",
            "font-size": "13px",
            color: props.currentPage === "trade" ? "#ffffff" : "#666666",
            "letter-spacing": "0.05em",
            transition: "color 0.3s ease",
          }}
        >
          TRADE
        </button>
        <button
          onClick={() => props.onNavigate("report")}
          style={{
            background: "transparent",
            border: "none",
            "font-size": "13px",
            color: props.currentPage === "report" ? "#ffffff" : "#666666",
            "letter-spacing": "0.05em",
            transition: "color 0.3s ease",
          }}
        >
          REPORT
        </button>
      </div>
    </nav>
  )
}

export default Navigation
