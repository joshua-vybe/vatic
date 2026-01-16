/**
 * Factory functions for generating test data
 */

export class UserFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `user-${Date.now()}-${Math.random()}`,
      email: `user${Math.random()}@example.com`,
      password_hash: "hashed_password",
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }
}

export class TierFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `tier-${Date.now()}-${Math.random()}`,
      name: "Professional",
      price: 99,
      account_size: 50000,
      max_drawdown: 0.1,
      min_trades: 10,
      max_risk_per_trade: 0.02,
      profit_split: 0.85,
      created_at: new Date(),
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }
}

export class AssessmentFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `assessment-${Date.now()}-${Math.random()}`,
      user_id: `user-${Date.now()}`,
      tier_id: `tier-${Date.now()}`,
      status: "active",
      balance: 50000,
      peak_balance: 50000,
      starting_balance: 50000,
      trading_days_completed: 0,
      min_trading_days: 10,
      total_trades: 0,
      min_trades: 10,
      created_at: new Date(),
      started_at: new Date(),
      completed_at: null,
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  static createPassed(overrides?: Partial<any>) {
    return this.create({
      status: "passed",
      balance: 54000,
      peak_balance: 54000,
      total_trades: 15,
      trading_days_completed: 10,
      completed_at: new Date(),
      ...overrides,
    });
  }

  static createFailed(overrides?: Partial<any>) {
    return this.create({
      status: "failed",
      balance: 40000,
      peak_balance: 50000,
      completed_at: new Date(),
      ...overrides,
    });
  }

  static createWithPositions(positions: any[], overrides?: Partial<any>) {
    return this.create({
      positions,
      ...overrides,
    });
  }
}

export class OrderFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `order-${Date.now()}-${Math.random()}`,
      assessment_id: `assessment-${Date.now()}`,
      symbol: "BTC/USD",
      side: "long",
      type: "MARKET",
      size: 1,
      price: 50000,
      status: "filled",
      created_at: new Date(),
      filled_at: new Date(),
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  static createLong(overrides?: Partial<any>) {
    return this.create({ side: "long", ...overrides });
  }

  static createShort(overrides?: Partial<any>) {
    return this.create({ side: "short", ...overrides });
  }

  static createPredictionYes(overrides?: Partial<any>) {
    return this.create({
      symbol: "polymarket:event-123",
      side: "yes",
      price: 0.6,
      ...overrides,
    });
  }

  static createPredictionNo(overrides?: Partial<any>) {
    return this.create({
      symbol: "polymarket:event-123",
      side: "no",
      price: 0.4,
      ...overrides,
    });
  }
}

export class PositionFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `pos-${Date.now()}-${Math.random()}`,
      assessment_id: `assessment-${Date.now()}`,
      symbol: "BTC/USD",
      side: "long",
      entry_price: 50000,
      current_price: 50000,
      size: 1,
      pnl: 0,
      pnl_percent: 0,
      opened_at: new Date(),
      closed_at: null,
      status: "open",
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  static createProfitable(overrides?: Partial<any>) {
    return this.create({
      current_price: 55000,
      pnl: 5000,
      pnl_percent: 0.1,
      ...overrides,
    });
  }

  static createLosing(overrides?: Partial<any>) {
    return this.create({
      current_price: 45000,
      pnl: -5000,
      pnl_percent: -0.1,
      ...overrides,
    });
  }

  static createCancelled(overrides?: Partial<any>) {
    return this.create({
      status: "cancelled",
      closed_at: new Date(),
      ...overrides,
    });
  }

  static createForEvent(eventId: string, overrides?: Partial<any>) {
    return this.create({
      symbol: `polymarket:${eventId}`,
      ...overrides,
    });
  }
}

export class TradeFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `trade-${Date.now()}-${Math.random()}`,
      assessment_id: `assessment-${Date.now()}`,
      symbol: "BTC/USD",
      side: "long",
      type: "MARKET",
      entry_price: 50000,
      exit_price: 51000,
      size: 1,
      pnl: 1000,
      opened_at: new Date(),
      closed_at: new Date(),
      cancelled: false,
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  static createWinning(overrides?: Partial<any>) {
    return this.create({
      exit_price: 55000,
      pnl: 5000,
      ...overrides,
    });
  }

  static createLosing(overrides?: Partial<any>) {
    return this.create({
      exit_price: 45000,
      pnl: -5000,
      ...overrides,
    });
  }

  static createCancelled(overrides?: Partial<any>) {
    return this.create({
      cancelled: true,
      ...overrides,
    });
  }
}

export class WithdrawalFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `withdrawal-${Date.now()}-${Math.random()}`,
      funded_account_id: `account-${Date.now()}`,
      amount: 1000,
      status: "pending",
      requested_at: new Date(),
      processed_at: null,
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  static createProcessed(overrides?: Partial<any>) {
    return this.create({
      status: "processed",
      processed_at: new Date(),
      ...overrides,
    });
  }

  static createFailed(overrides?: Partial<any>) {
    return this.create({
      status: "failed",
      processed_at: new Date(),
      ...overrides,
    });
  }
}

export class FundedAccountFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `account-${Date.now()}-${Math.random()}`,
      user_id: `user-${Date.now()}`,
      tier_id: `tier-${Date.now()}`,
      balance: 50000,
      starting_balance: 50000,
      total_withdrawals: 0,
      status: "active",
      created_at: new Date(),
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  static createSuspended(overrides?: Partial<any>) {
    return this.create({
      status: "suspended",
      ...overrides,
    });
  }

  static createClosed(overrides?: Partial<any>) {
    return this.create({
      status: "closed",
      ...overrides,
    });
  }
}

export class ViolationFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `violation-${Date.now()}-${Math.random()}`,
      assessment_id: `assessment-${Date.now()}`,
      type: "daily_loss",
      message: "Daily loss limit exceeded",
      timestamp: new Date(),
      severity: "critical",
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  static createDrawdownViolation(overrides?: Partial<any>) {
    return this.create({
      type: "drawdown",
      message: "Maximum drawdown exceeded",
      ...overrides,
    });
  }

  static createRiskViolation(overrides?: Partial<any>) {
    return this.create({
      type: "risk_per_trade",
      message: "Risk per trade limit exceeded",
      ...overrides,
    });
  }
}

export class MarketFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `market-${Date.now()}-${Math.random()}`,
      symbol: "BTC/USD",
      name: "Bitcoin / US Dollar",
      type: "crypto",
      price: 50000,
      change24h: 0.05,
      volume24h: 1000000000,
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  static createCrypto(overrides?: Partial<any>) {
    return this.create({
      type: "crypto",
      ...overrides,
    });
  }

  static createPolymarket(overrides?: Partial<any>) {
    return this.create({
      symbol: "polymarket:event-123",
      type: "prediction",
      price: 0.6,
      probability: 0.6,
      ...overrides,
    });
  }

  static createKalshi(overrides?: Partial<any>) {
    return this.create({
      symbol: "kalshi:event-456",
      type: "prediction",
      price: 0.4,
      probability: 0.4,
      ...overrides,
    });
  }
}

export class PurchaseFactory {
  static create(overrides?: Partial<any>) {
    return {
      id: `purchase-${Date.now()}-${Math.random()}`,
      user_id: `user-${Date.now()}`,
      tier_id: `tier-${Date.now()}`,
      stripe_session_id: `session-${Date.now()}`,
      status: "completed",
      created_at: new Date(),
      ...overrides,
    };
  }

  static createMany(count: number, overrides?: Partial<any>) {
    return Array.from({ length: count }, () => this.create(overrides));
  }

  static createPending(overrides?: Partial<any>) {
    return this.create({
      status: "pending",
      ...overrides,
    });
  }

  static createFailed(overrides?: Partial<any>) {
    return this.create({
      status: "failed",
      ...overrides,
    });
  }
}
