import type { Challenge, Order } from "../types"

export const validateOrder = (
  order: Order,
  challenge: Challenge,
  currentPositions: number,
): { valid: boolean; message?: string } => {
  // Check risk per trade (2% max)
  const riskAmount = order.size * order.leverage! || order.size
  const riskPercent = (riskAmount / challenge.currentBalance) * 100

  if (riskPercent > 2) {
    return {
      valid: false,
      message: `Risk per trade exceeds 2% limit (${riskPercent.toFixed(2)}%)`,
    }
  }

  // Check daily loss limit
  const dailyLoss = challenge.startingBalance - challenge.currentBalance
  const dailyLossPercent = (dailyLoss / challenge.startingBalance) * 100

  if (dailyLossPercent >= challenge.maxDailyLoss) {
    return {
      valid: false,
      message: `Daily loss limit of ${challenge.maxDailyLoss}% reached`,
    }
  }

  // Check overall drawdown
  const drawdown = challenge.startingBalance - challenge.currentBalance
  const drawdownPercent = (drawdown / challenge.startingBalance) * 100

  if (drawdownPercent >= challenge.maxDrawdown) {
    return {
      valid: false,
      message: `Maximum drawdown of ${challenge.maxDrawdown}% reached`,
    }
  }

  return { valid: true }
}

export const checkChallengeCompletion = (
  challenge: Challenge,
): {
  passed: boolean
  reason?: string
} => {
  const profitPercent = ((challenge.currentBalance - challenge.startingBalance) / challenge.startingBalance) * 100

  // Check if profit target met
  if (profitPercent < challenge.profitTarget) {
    return {
      passed: false,
      reason: `Profit target not met (${profitPercent.toFixed(2)}% / ${challenge.profitTarget}%)`,
    }
  }

  // Check minimum trading days
  if (challenge.daysTraded < challenge.minTradingDays) {
    return {
      passed: false,
      reason: `Minimum trading days not met (${challenge.daysTraded} / ${challenge.minTradingDays})`,
    }
  }

  // Check violations
  const criticalViolations = challenge.violations.filter((v) => v.severity === "critical")
  if (criticalViolations.length > 0) {
    return {
      passed: false,
      reason: "Critical rule violations present",
    }
  }

  return { passed: true }
}
