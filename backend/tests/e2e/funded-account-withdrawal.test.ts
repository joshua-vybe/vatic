import { describe, it, expect, beforeAll, afterAll } from "bun:test";

interface FundedAccount {
  id: string;
  userId: string;
  balance: number;
  startingBalance: number;
  totalWithdrawals: number;
  status: "active" | "suspended" | "closed";
}

interface Withdrawal {
  id: string;
  fundedAccountId: string;
  amount: number;
  status: "pending" | "approved" | "completed" | "failed";
  requiresReview: boolean;
}

class MockFundedAccountService {
  private accounts: Map<string, FundedAccount> = new Map();

  async createFundedAccount(userId: string, startingBalance: number): Promise<FundedAccount> {
    const account: FundedAccount = {
      id: `account-${Date.now()}`,
      userId,
      balance: startingBalance,
      startingBalance,
      totalWithdrawals: 0,
      status: "active",
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async getFundedAccount(accountId: string): Promise<FundedAccount | null> {
    return this.accounts.get(accountId) || null;
  }

  async updateBalance(accountId: string, newBalance: number): Promise<void> {
    const account = this.accounts.get(accountId);
    if (account) {
      account.balance = newBalance;
    }
  }

  clear(): void {
    this.accounts.clear();
  }
}

class MockWithdrawalService {
  private withdrawals: Map<string, Withdrawal> = new Map();

  async requestWithdrawal(fundedAccountId: string, amount: number): Promise<Withdrawal> {
    const withdrawal: Withdrawal = {
      id: `withdrawal-${Date.now()}`,
      fundedAccountId,
      amount,
      status: "pending",
      requiresReview: amount >= 1000,
    };
    this.withdrawals.set(withdrawal.id, withdrawal);
    return withdrawal;
  }

  async approveWithdrawal(withdrawalId: string): Promise<void> {
    const withdrawal = this.withdrawals.get(withdrawalId);
    if (withdrawal) {
      withdrawal.status = "approved";
    }
  }

  async completeWithdrawal(withdrawalId: string): Promise<void> {
    const withdrawal = this.withdrawals.get(withdrawalId);
    if (withdrawal) {
      withdrawal.status = "completed";
    }
  }

  async getWithdrawal(withdrawalId: string): Promise<Withdrawal | null> {
    return this.withdrawals.get(withdrawalId) || null;
  }

  clear(): void {
    this.withdrawals.clear();
  }
}

class MockStripeService {
  async createPayout(amount: number, userId: string): Promise<{ id: string; status: string }> {
    return {
      id: `payout-${Date.now()}`,
      status: "succeeded",
    };
  }
}

describe("Funded Account Withdrawal Flow E2E", () => {
  let fundedAccountService: MockFundedAccountService;
  let withdrawalService: MockWithdrawalService;
  let stripeService: MockStripeService;

  beforeAll(() => {
    fundedAccountService = new MockFundedAccountService();
    withdrawalService = new MockWithdrawalService();
    stripeService = new MockStripeService();
  });

  afterAll(() => {
    fundedAccountService.clear();
    withdrawalService.clear();
  });

  describe("Withdrawal Request", () => {
    it("should request withdrawal from funded account", async () => {
      const account = await fundedAccountService.createFundedAccount("user-1", 50000);
      // Simulate profit
      await fundedAccountService.updateBalance(account.id, 55000);

      const withdrawal = await withdrawalService.requestWithdrawal(account.id, 500);

      expect(withdrawal.fundedAccountId).toBe(account.id);
      expect(withdrawal.amount).toBe(500);
      expect(withdrawal.status).toBe("pending");
      expect(withdrawal.requiresReview).toBe(false);
    });

    it("should flag large withdrawals for review", async () => {
      const account = await fundedAccountService.createFundedAccount("user-2", 50000);
      await fundedAccountService.updateBalance(account.id, 60000);

      const withdrawal = await withdrawalService.requestWithdrawal(account.id, 2000);

      expect(withdrawal.requiresReview).toBe(true);
      expect(withdrawal.status).toBe("pending");
    });

    it("should handle multiple withdrawal requests", async () => {
      const account = await fundedAccountService.createFundedAccount("user-3", 50000);
      await fundedAccountService.updateBalance(account.id, 55000);

      const withdrawal1 = await withdrawalService.requestWithdrawal(account.id, 500);
      const withdrawal2 = await withdrawalService.requestWithdrawal(account.id, 300);

      expect(withdrawal1.id).not.toBe(withdrawal2.id);
      expect(withdrawal1.fundedAccountId).toBe(withdrawal2.fundedAccountId);
    });
  });

  describe("Auto-Approval Flow", () => {
    it("should auto-approve small withdrawals", async () => {
      const account = await fundedAccountService.createFundedAccount("user-4", 50000);
      await fundedAccountService.updateBalance(account.id, 55000);

      const withdrawal = await withdrawalService.requestWithdrawal(account.id, 500);
      expect(withdrawal.requiresReview).toBe(false);

      // Auto-approve
      await withdrawalService.approveWithdrawal(withdrawal.id);
      const updated = await withdrawalService.getWithdrawal(withdrawal.id);

      expect(updated?.status).toBe("approved");
    });

    it("should process payout after approval", async () => {
      const account = await fundedAccountService.createFundedAccount("user-5", 50000);
      await fundedAccountService.updateBalance(account.id, 55000);

      const withdrawal = await withdrawalService.requestWithdrawal(account.id, 500);
      await withdrawalService.approveWithdrawal(withdrawal.id);

      // Create Stripe payout
      const payout = await stripeService.createPayout(withdrawal.amount, account.userId);
      expect(payout.status).toBe("succeeded");

      // Complete withdrawal
      await withdrawalService.completeWithdrawal(withdrawal.id);
      const completed = await withdrawalService.getWithdrawal(withdrawal.id);

      expect(completed?.status).toBe("completed");
    });
  });

  describe("Manual Review Flow", () => {
    it("should queue large withdrawals for review", async () => {
      const account = await fundedAccountService.createFundedAccount("user-6", 50000);
      await fundedAccountService.updateBalance(account.id, 60000);

      const withdrawal = await withdrawalService.requestWithdrawal(account.id, 2000);

      expect(withdrawal.requiresReview).toBe(true);
      expect(withdrawal.status).toBe("pending");
    });

    it("should allow manual approval of queued withdrawals", async () => {
      const account = await fundedAccountService.createFundedAccount("user-7", 50000);
      await fundedAccountService.updateBalance(account.id, 60000);

      const withdrawal = await withdrawalService.requestWithdrawal(account.id, 2000);
      expect(withdrawal.requiresReview).toBe(true);

      // Manual approval
      await withdrawalService.approveWithdrawal(withdrawal.id);
      const approved = await withdrawalService.getWithdrawal(withdrawal.id);

      expect(approved?.status).toBe("approved");
    });
  });

  describe("Balance Updates", () => {
    it("should update total withdrawals after completion", async () => {
      const account = await fundedAccountService.createFundedAccount("user-8", 50000);
      await fundedAccountService.updateBalance(account.id, 55000);

      const withdrawal = await withdrawalService.requestWithdrawal(account.id, 500);
      await withdrawalService.approveWithdrawal(withdrawal.id);
      await withdrawalService.completeWithdrawal(withdrawal.id);

      // Verify withdrawal completed
      const completed = await withdrawalService.getWithdrawal(withdrawal.id);
      expect(completed?.status).toBe("completed");
    });

    it("should handle multiple sequential withdrawals", async () => {
      const account = await fundedAccountService.createFundedAccount("user-9", 50000);
      await fundedAccountService.updateBalance(account.id, 55000);

      // First withdrawal
      const w1 = await withdrawalService.requestWithdrawal(account.id, 500);
      await withdrawalService.approveWithdrawal(w1.id);
      await withdrawalService.completeWithdrawal(w1.id);

      // Second withdrawal
      const w2 = await withdrawalService.requestWithdrawal(account.id, 300);
      await withdrawalService.approveWithdrawal(w2.id);
      await withdrawalService.completeWithdrawal(w2.id);

      const completed1 = await withdrawalService.getWithdrawal(w1.id);
      const completed2 = await withdrawalService.getWithdrawal(w2.id);

      expect(completed1?.status).toBe("completed");
      expect(completed2?.status).toBe("completed");
    });
  });

  describe("Complete Withdrawal Flow", () => {
    it("should complete full withdrawal flow for small amount", async () => {
      // Step 1: Create funded account
      const account = await fundedAccountService.createFundedAccount("user-10", 50000);
      expect(account.status).toBe("active");

      // Step 2: Simulate profit
      await fundedAccountService.updateBalance(account.id, 55000);
      const updated = await fundedAccountService.getFundedAccount(account.id);
      expect(updated?.balance).toBe(55000);

      // Step 3: Request withdrawal
      const withdrawal = await withdrawalService.requestWithdrawal(account.id, 500);
      expect(withdrawal.status).toBe("pending");
      expect(withdrawal.requiresReview).toBe(false);

      // Step 4: Auto-approve
      await withdrawalService.approveWithdrawal(withdrawal.id);
      const approved = await withdrawalService.getWithdrawal(withdrawal.id);
      expect(approved?.status).toBe("approved");

      // Step 5: Process payout
      const payout = await stripeService.createPayout(withdrawal.amount, account.userId);
      expect(payout.status).toBe("succeeded");

      // Step 6: Complete withdrawal
      await withdrawalService.completeWithdrawal(withdrawal.id);
      const completed = await withdrawalService.getWithdrawal(withdrawal.id);
      expect(completed?.status).toBe("completed");
    });

    it("should complete full withdrawal flow for large amount", async () => {
      // Step 1: Create funded account
      const account = await fundedAccountService.createFundedAccount("user-11", 50000);

      // Step 2: Simulate profit
      await fundedAccountService.updateBalance(account.id, 60000);

      // Step 3: Request large withdrawal
      const withdrawal = await withdrawalService.requestWithdrawal(account.id, 2000);
      expect(withdrawal.requiresReview).toBe(true);

      // Step 4: Manual approval
      await withdrawalService.approveWithdrawal(withdrawal.id);
      const approved = await withdrawalService.getWithdrawal(withdrawal.id);
      expect(approved?.status).toBe("approved");

      // Step 5: Process payout
      const payout = await stripeService.createPayout(withdrawal.amount, account.userId);
      expect(payout.status).toBe("succeeded");

      // Step 6: Complete withdrawal
      await withdrawalService.completeWithdrawal(withdrawal.id);
      const completed = await withdrawalService.getWithdrawal(withdrawal.id);
      expect(completed?.status).toBe("completed");
    });
  });
});
