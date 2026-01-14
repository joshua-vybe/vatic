-- CreateTable users
CREATE TABLE "users" (
    "id" STRING NOT NULL,
    "email" STRING NOT NULL,
    "password_hash" STRING NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable sessions
CREATE TABLE "sessions" (
    "id" STRING NOT NULL,
    "user_id" STRING NOT NULL,
    "token" STRING NOT NULL,
    "expires_at" TIMESTAMP NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable tiers
CREATE TABLE "tiers" (
    "id" STRING NOT NULL,
    "name" STRING NOT NULL,
    "price" INT4 NOT NULL,
    "starting_balance" INT4 NOT NULL,
    "max_drawdown" FLOAT8 NOT NULL,
    "min_trades" INT4 NOT NULL,
    "max_risk_per_trade" FLOAT8 NOT NULL,
    "profit_split" FLOAT8 NOT NULL,

    CONSTRAINT "tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable purchases
CREATE TABLE "purchases" (
    "id" STRING NOT NULL,
    "user_id" STRING NOT NULL,
    "tier_id" STRING NOT NULL,
    "stripe_payment_id" STRING NOT NULL,
    "status" STRING NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable assessments
CREATE TABLE "assessments" (
    "id" STRING NOT NULL,
    "user_id" STRING NOT NULL,
    "tier_id" STRING NOT NULL,
    "purchase_id" STRING NOT NULL,
    "status" STRING NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP,
    "completed_at" TIMESTAMP,
    "deleted_at" TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable virtual_accounts
CREATE TABLE "virtual_accounts" (
    "id" STRING NOT NULL,
    "assessment_id" STRING NOT NULL,
    "starting_balance" INT4 NOT NULL,
    "current_balance" FLOAT8 NOT NULL,
    "peak_balance" FLOAT8 NOT NULL,
    "realized_pnl" FLOAT8 NOT NULL,
    "unrealized_pnl" FLOAT8 NOT NULL,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable positions
CREATE TABLE "positions" (
    "id" STRING NOT NULL,
    "assessment_id" STRING NOT NULL,
    "market" STRING NOT NULL,
    "side" STRING NOT NULL,
    "quantity" FLOAT8 NOT NULL,
    "entry_price" FLOAT8 NOT NULL,
    "current_price" FLOAT8 NOT NULL,
    "unrealized_pnl" FLOAT8 NOT NULL,
    "opened_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable trades
CREATE TABLE "trades" (
    "id" STRING NOT NULL,
    "assessment_id" STRING NOT NULL,
    "position_id" STRING NOT NULL,
    "type" STRING NOT NULL,
    "market" STRING NOT NULL,
    "side" STRING NOT NULL,
    "quantity" FLOAT8 NOT NULL,
    "price" FLOAT8 NOT NULL,
    "slippage" FLOAT8 NOT NULL,
    "fee" FLOAT8 NOT NULL,
    "pnl" FLOAT8 NOT NULL,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable rule_checks
CREATE TABLE "rule_checks" (
    "id" STRING NOT NULL,
    "assessment_id" STRING NOT NULL,
    "rule_type" STRING NOT NULL,
    "value" FLOAT8 NOT NULL,
    "threshold" FLOAT8 NOT NULL,
    "status" STRING NOT NULL,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable violations
CREATE TABLE "violations" (
    "id" STRING NOT NULL,
    "assessment_id" STRING NOT NULL,
    "rule_type" STRING NOT NULL,
    "value" FLOAT8 NOT NULL,
    "threshold" FLOAT8 NOT NULL,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "violations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_assessment_id_key" ON "virtual_accounts"("assessment_id");

-- CreateIndex
CREATE INDEX "positions_assessment_id_closed_at_idx" ON "positions"("assessment_id", "closed_at");

-- CreateIndex
CREATE INDEX "trades_assessment_id_timestamp_idx" ON "trades"("assessment_id", "timestamp");

-- CreateIndex
CREATE INDEX "rule_checks_assessment_id_timestamp_idx" ON "rule_checks"("assessment_id", "timestamp");

-- CreateIndex
CREATE INDEX "violations_assessment_id_idx" ON "violations"("assessment_id");

-- CreateIndex
CREATE INDEX "purchases_user_id_idx" ON "purchases"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_stripe_payment_id_key" ON "purchases"("stripe_payment_id");

-- CreateIndex
CREATE INDEX "assessments_user_id_status_idx" ON "assessments"("user_id", "status");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "tiers"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "tiers"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_checks" ADD CONSTRAINT "rule_checks_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
