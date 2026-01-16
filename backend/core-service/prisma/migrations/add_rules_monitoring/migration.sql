-- Verify and create rule_checks table if it doesn't exist
CREATE TABLE IF NOT EXISTS "rule_checks" (
  "id" STRING PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" STRING NOT NULL,
  "rule_type" STRING NOT NULL,
  "value" FLOAT NOT NULL,
  "threshold" FLOAT NOT NULL,
  "status" STRING NOT NULL,
  "timestamp" TIMESTAMP NOT NULL DEFAULT now(),
  
  CONSTRAINT "fk_assessment_rulecheck" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE
);

-- Create index on (assessment_id, timestamp) for efficient querying
CREATE INDEX IF NOT EXISTS "idx_rulecheck_assessment_timestamp" ON "rule_checks"("assessment_id", "timestamp");

-- Create index on (rule_type, status) for filtering by rule type and status
CREATE INDEX IF NOT EXISTS "idx_rulecheck_type_status" ON "rule_checks"("rule_type", "status");

-- Verify and create violations table if it doesn't exist
CREATE TABLE IF NOT EXISTS "violations" (
  "id" STRING PRIMARY KEY DEFAULT gen_random_uuid(),
  "assessment_id" STRING NOT NULL,
  "rule_type" STRING NOT NULL,
  "value" FLOAT NOT NULL,
  "threshold" FLOAT NOT NULL,
  "timestamp" TIMESTAMP NOT NULL DEFAULT now(),
  
  CONSTRAINT "fk_assessment_violation" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE
);

-- Create index on (assessment_id) for efficient querying
CREATE INDEX IF NOT EXISTS "idx_violation_assessment" ON "violations"("assessment_id");

-- Create index on (timestamp) for time-based queries
CREATE INDEX IF NOT EXISTS "idx_violation_timestamp" ON "violations"("timestamp");
