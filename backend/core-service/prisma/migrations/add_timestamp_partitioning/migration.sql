-- Add timestamp-based partitioning for trades table
-- This migration partitions the trades table by timestamp (monthly intervals)
-- Note: CockroachDB uses RANGE partitioning with INTERVAL syntax

-- First, we need to recreate the trades table with partitioning
-- CockroachDB requires the table to be recreated with partitioning from scratch

-- Create a temporary table to hold existing data
CREATE TABLE trades_temp AS SELECT * FROM trades;

-- Drop the existing trades table (this will cascade to foreign keys)
DROP TABLE trades CASCADE;

-- Recreate the trades table with timestamp-based partitioning
-- Using monthly partitions starting from 2024-01-01
CREATE TABLE trades (
  id STRING PRIMARY KEY,
  assessment_id STRING NOT NULL,
  position_id STRING NOT NULL,
  type STRING NOT NULL,
  market STRING NOT NULL,
  side STRING NOT NULL,
  quantity FLOAT NOT NULL,
  price FLOAT NOT NULL,
  slippage FLOAT NOT NULL,
  fee FLOAT NOT NULL,
  pnl FLOAT NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT now(),
  
  CONSTRAINT fk_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE,
  
  INDEX idx_assessment_timestamp (assessment_id, timestamp)
) PARTITION BY RANGE (timestamp) (
  PARTITION p_2024_01 VALUES FROM ('2024-01-01') TO ('2024-02-01'),
  PARTITION p_2024_02 VALUES FROM ('2024-02-01') TO ('2024-03-01'),
  PARTITION p_2024_03 VALUES FROM ('2024-03-01') TO ('2024-04-01'),
  PARTITION p_2024_04 VALUES FROM ('2024-04-01') TO ('2024-05-01'),
  PARTITION p_2024_05 VALUES FROM ('2024-05-01') TO ('2024-06-01'),
  PARTITION p_2024_06 VALUES FROM ('2024-06-01') TO ('2024-07-01'),
  PARTITION p_2024_07 VALUES FROM ('2024-07-01') TO ('2024-08-01'),
  PARTITION p_2024_08 VALUES FROM ('2024-08-01') TO ('2024-09-01'),
  PARTITION p_2024_09 VALUES FROM ('2024-09-01') TO ('2024-10-01'),
  PARTITION p_2024_10 VALUES FROM ('2024-10-01') TO ('2024-11-01'),
  PARTITION p_2024_11 VALUES FROM ('2024-11-01') TO ('2024-12-01'),
  PARTITION p_2024_12 VALUES FROM ('2024-12-01') TO ('2025-01-01'),
  PARTITION p_2025_01 VALUES FROM ('2025-01-01') TO ('2025-02-01'),
  PARTITION p_2025_02 VALUES FROM ('2025-02-01') TO ('2025-03-01'),
  PARTITION p_2025_03 VALUES FROM ('2025-03-01') TO ('2025-04-01'),
  PARTITION p_2025_04 VALUES FROM ('2025-04-01') TO ('2025-05-01'),
  PARTITION p_2025_05 VALUES FROM ('2025-05-01') TO ('2025-06-01'),
  PARTITION p_2025_06 VALUES FROM ('2025-06-01') TO ('2025-07-01'),
  PARTITION p_2025_07 VALUES FROM ('2025-07-01') TO ('2025-08-01'),
  PARTITION p_2025_08 VALUES FROM ('2025-08-01') TO ('2025-09-01'),
  PARTITION p_2025_09 VALUES FROM ('2025-09-01') TO ('2025-10-01'),
  PARTITION p_2025_10 VALUES FROM ('2025-10-01') TO ('2025-11-01'),
  PARTITION p_2025_11 VALUES FROM ('2025-11-01') TO ('2025-12-01'),
  PARTITION p_2025_12 VALUES FROM ('2025-12-01') TO ('2026-01-01'),
  PARTITION p_future VALUES FROM ('2026-01-01') TO (MAXVALUE)
);

-- Restore data from temporary table
INSERT INTO trades SELECT * FROM trades_temp;

-- Drop temporary table
DROP TABLE trades_temp;

-- Add timestamp-based partitioning for positions table
-- Using daily partitions based on opened_at

-- Create a temporary table to hold existing data
CREATE TABLE positions_temp AS SELECT * FROM positions;

-- Drop the existing positions table
DROP TABLE positions CASCADE;

-- Recreate the positions table with timestamp-based partitioning
CREATE TABLE positions (
  id STRING PRIMARY KEY,
  assessment_id STRING NOT NULL,
  market STRING NOT NULL,
  side STRING NOT NULL,
  quantity FLOAT NOT NULL,
  entry_price FLOAT NOT NULL,
  current_price FLOAT NOT NULL,
  unrealized_pnl FLOAT NOT NULL,
  opened_at TIMESTAMP NOT NULL DEFAULT now(),
  closed_at TIMESTAMP,
  
  CONSTRAINT fk_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  
  INDEX idx_assessment_closed (assessment_id, closed_at)
) PARTITION BY RANGE (opened_at) (
  PARTITION p_2024_01_01 VALUES FROM ('2024-01-01') TO ('2024-01-02'),
  PARTITION p_2024_01_02 VALUES FROM ('2024-01-02') TO ('2024-01-03'),
  PARTITION p_2024_01_03 VALUES FROM ('2024-01-03') TO ('2024-01-04'),
  PARTITION p_2024_01_04 VALUES FROM ('2024-01-04') TO ('2024-01-05'),
  PARTITION p_2024_01_05 VALUES FROM ('2024-01-05') TO ('2024-01-06'),
  PARTITION p_2024_01_06 VALUES FROM ('2024-01-06') TO ('2024-01-07'),
  PARTITION p_2024_01_07 VALUES FROM ('2024-01-07') TO ('2024-01-08'),
  PARTITION p_2024_01_08 VALUES FROM ('2024-01-08') TO ('2024-01-09'),
  PARTITION p_2024_01_09 VALUES FROM ('2024-01-09') TO ('2024-01-10'),
  PARTITION p_2024_01_10 VALUES FROM ('2024-01-10') TO ('2024-01-11'),
  PARTITION p_2024_01_11 VALUES FROM ('2024-01-11') TO ('2024-01-12'),
  PARTITION p_2024_01_12 VALUES FROM ('2024-01-12') TO ('2024-01-13'),
  PARTITION p_2024_01_13 VALUES FROM ('2024-01-13') TO ('2024-01-14'),
  PARTITION p_2024_01_14 VALUES FROM ('2024-01-14') TO ('2024-01-15'),
  PARTITION p_2024_01_15 VALUES FROM ('2024-01-15') TO ('2024-01-16'),
  PARTITION p_2024_01_16 VALUES FROM ('2024-01-16') TO ('2024-01-17'),
  PARTITION p_2024_01_17 VALUES FROM ('2024-01-17') TO ('2024-01-18'),
  PARTITION p_2024_01_18 VALUES FROM ('2024-01-18') TO ('2024-01-19'),
  PARTITION p_2024_01_19 VALUES FROM ('2024-01-19') TO ('2024-01-20'),
  PARTITION p_2024_01_20 VALUES FROM ('2024-01-20') TO ('2024-01-21'),
  PARTITION p_2024_01_21 VALUES FROM ('2024-01-21') TO ('2024-01-22'),
  PARTITION p_2024_01_22 VALUES FROM ('2024-01-22') TO ('2024-01-23'),
  PARTITION p_2024_01_23 VALUES FROM ('2024-01-23') TO ('2024-01-24'),
  PARTITION p_2024_01_24 VALUES FROM ('2024-01-24') TO ('2024-01-25'),
  PARTITION p_2024_01_25 VALUES FROM ('2024-01-25') TO ('2024-01-26'),
  PARTITION p_2024_01_26 VALUES FROM ('2024-01-26') TO ('2024-01-27'),
  PARTITION p_2024_01_27 VALUES FROM ('2024-01-27') TO ('2024-01-28'),
  PARTITION p_2024_01_28 VALUES FROM ('2024-01-28') TO ('2024-01-29'),
  PARTITION p_2024_01_29 VALUES FROM ('2024-01-29') TO ('2024-01-30'),
  PARTITION p_2024_01_30 VALUES FROM ('2024-01-30') TO ('2024-01-31'),
  PARTITION p_2024_01_31 VALUES FROM ('2024-01-31') TO ('2024-02-01'),
  PARTITION p_future VALUES FROM ('2024-02-01') TO (MAXVALUE)
);

-- Restore data from temporary table
INSERT INTO positions SELECT * FROM positions_temp;

-- Drop temporary table
DROP TABLE positions_temp;

-- Add comment documenting the partitioning strategy
-- Trades: Monthly partitions for efficient querying by time period
-- Positions: Daily partitions for efficient querying by open date
-- Both use RANGE partitioning with MAXVALUE for future dates
