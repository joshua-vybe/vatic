#!/bin/bash

# Load Test Runner Script
# 
# Executes multiple load test scenarios using Locust:
# 1. Ramp-up Test: 1,000 concurrent users over 5 minutes
# 2. Sustained Load: 10,000 orders/sec for 5 minutes
# 3. Spike Test: 0 → 5,000 users in 30 seconds
# 4. Stress Test: Gradually increase until breaking point
#
# Usage: ./run-load-tests.sh <target_url>
# Example: ./run-load-tests.sh http://localhost:3000

set -e

# Configuration
TARGET_URL="${1:-http://localhost:3000}"
RESULTS_DIR="./results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${RESULTS_DIR}/load-test-${TIMESTAMP}.log"

# Create results directory
mkdir -p "${RESULTS_DIR}"

echo "=========================================="
echo "Load Test Suite"
echo "=========================================="
echo "Target URL: ${TARGET_URL}"
echo "Results Directory: ${RESULTS_DIR}"
echo "Timestamp: ${TIMESTAMP}"
echo "=========================================="
echo ""

# Function to run a load test scenario
run_scenario() {
  local scenario_name=$1
  local users=$2
  local spawn_rate=$3
  local run_time=$4
  local description=$5

  echo "Running Scenario: ${scenario_name}"
  echo "Description: ${description}"
  echo "Users: ${users}, Spawn Rate: ${spawn_rate}/sec, Duration: ${run_time}"
  echo ""

  local scenario_log="${RESULTS_DIR}/${scenario_name}-${TIMESTAMP}.log"
  local scenario_csv="${RESULTS_DIR}/${scenario_name}-${TIMESTAMP}.csv"

  locust \
    -f locustfile.py \
    --headless \
    --users ${users} \
    --spawn-rate ${spawn_rate} \
    --run-time ${run_time} \
    --host ${TARGET_URL} \
    --csv=${scenario_csv} \
    --loglevel INFO \
    2>&1 | tee -a "${scenario_log}"

  echo "✓ Scenario completed: ${scenario_name}"
  echo "Results saved to: ${scenario_csv}"
  echo ""
}

# Scenario 1: Ramp-up Test
# Target: 1,000 concurrent users over 5 minutes
# Spawn rate: 200 users/min = 3.33 users/sec
# Metrics: p99 <10ms, error rate <0.1%
echo "=========================================="
echo "SCENARIO 1: RAMP-UP TEST"
echo "=========================================="
run_scenario \
  "ramp-up" \
  1000 \
  3 \
  "5m" \
  "Gradually ramp up to 1,000 concurrent users over 5 minutes"

# Scenario 2: Sustained Load
# Target: 10,000 orders/sec for 5 minutes
# With TradingUser (20x order weight) and HighFrequencyTradingUser (50x order weight):
# - 500 TradingUser: 500 * 20 = 10,000 orders/sec
# - 100 HighFrequencyTradingUser: 100 * 50 = 5,000 orders/sec
# Total: ~15,000 orders/sec (exceeds target)
# Spawn rate: 120 users/min = 2 users/sec
# Metrics: p99 <10ms, error rate <0.1%
echo "=========================================="
echo "SCENARIO 2: SUSTAINED LOAD"
echo "=========================================="
run_scenario \
  "sustained" \
  600 \
  2 \
  "5m" \
  "Sustain 600 concurrent users (target: 10,000 orders/sec) for 5 minutes"

# Scenario 3: Spike Test
# Target: 0 → 5,000 users in 30 seconds
# Spawn rate: 10,000 users/min = 166.67 users/sec
# Metrics: p99 <15ms (spike tolerance), error rate <1%
echo "=========================================="
echo "SCENARIO 3: SPIKE TEST"
echo "=========================================="
run_scenario \
  "spike" \
  5000 \
  167 \
  "30s" \
  "Spike from 0 to 5,000 users in 30 seconds"

# Scenario 4: Stress Test
# Target: Identify breaking point
# Start with 2,000 users and gradually increase
# Spawn rate: 200 users/min = 3.33 users/sec
# Duration: 10 minutes
# Metrics: Identify when p99 >10ms or error rate >0.1%
echo "=========================================="
echo "SCENARIO 4: STRESS TEST"
echo "=========================================="
run_scenario \
  "stress" \
  2000 \
  3 \
  "10m" \
  "Gradually increase load to identify breaking point"

# Parse and summarize results
echo "=========================================="
echo "LOAD TEST SUMMARY"
echo "=========================================="
echo ""

# Function to parse CSV results and extract p99 latency
parse_results() {
  local csv_file=$1
  local scenario_name=$2
  local target_rps=$3

  if [ ! -f "${csv_file}" ]; then
    echo "⚠️  Results file not found: ${csv_file}"
    return 1
  fi

  echo "Scenario: ${scenario_name}"
  echo "Results file: ${csv_file}"
  echo ""

  # Locust CSV format: Name,# requests,# failures,Median response time,Average response time,Min response time,Max response time,Average Content Length,Requests/s
  # For p99, we need to use --csv-full-history or parse from stats_history.csv
  
  local total_requests=$(tail -1 "${csv_file}" | cut -d',' -f2)
  local total_failures=$(tail -1 "${csv_file}" | cut -d',' -f3)
  local median_response=$(tail -1 "${csv_file}" | cut -d',' -f4)
  local avg_response=$(tail -1 "${csv_file}" | cut -d',' -f5)
  local min_response=$(tail -1 "${csv_file}" | cut -d',' -f6)
  local max_response=$(tail -1 "${csv_file}" | cut -d',' -f7)
  local requests_per_sec=$(tail -1 "${csv_file}" | cut -d',' -f9)

  if [ -z "${total_requests}" ] || [ "${total_requests}" = "# requests" ]; then
    echo "⚠️  Could not parse results from ${csv_file}"
    return 1
  fi

  local failure_rate=0
  if [ "${total_requests}" -gt 0 ]; then
    failure_rate=$((total_failures * 100 / total_requests))
  fi

  echo "Total Requests: ${total_requests}"
  echo "Total Failures: ${total_failures}"
  echo "Failure Rate: ${failure_rate}%"
  echo "Median Response Time: ${median_response}ms"
  echo "Average Response Time: ${avg_response}ms"
  echo "Min Response Time: ${min_response}ms"
  echo "Max Response Time: ${max_response}ms"
  echo "Requests/sec: ${requests_per_sec}"
  echo ""

  # Check targets
  local p99_target=10
  local error_rate_target=0.1
  local rps_threshold=9000  # Allow 10% margin below 10k target

  # Use max response time as conservative p99 estimate (actual p99 would be lower)
  # For proper p99, Locust would need --csv-full-history flag
  local p99_latency=${max_response}

  local pass=true

  # Check p99 latency
  if (( $(echo "${p99_latency} < ${p99_target}" | bc -l) )); then
    echo "✓ P99 Latency Target: <${p99_target}ms - PASS (${p99_latency}ms)"
  else
    echo "✗ P99 Latency Target: <${p99_target}ms - FAIL (${p99_latency}ms)"
    pass=false
  fi

  # Check error rate
  if (( $(echo "${failure_rate} < ${error_rate_target}" | bc -l) )); then
    echo "✓ Error Rate Target: <${error_rate_target}% - PASS (${failure_rate}%)"
  else
    echo "✗ Error Rate Target: <${error_rate_target}% - FAIL (${failure_rate}%)"
    pass=false
  fi

  # Check RPS if target provided
  if [ -n "${target_rps}" ] && [ "${target_rps}" -gt 0 ]; then
    if (( $(echo "${requests_per_sec} > ${rps_threshold}" | bc -l) )); then
      echo "✓ RPS Target: >${rps_threshold} - PASS (${requests_per_sec} RPS)"
    else
      echo "✗ RPS Target: >${rps_threshold} - FAIL (${requests_per_sec} RPS)"
      pass=false
    fi
  fi

  echo ""

  if [ "$pass" = true ]; then
    return 0
  else
    return 1
  fi
}

# Parse results for each scenario
parse_results "${RESULTS_DIR}/ramp-up-${TIMESTAMP}.csv" "Ramp-up Test" 0
parse_results "${RESULTS_DIR}/sustained-${TIMESTAMP}.csv" "Sustained Load" 10000
parse_results "${RESULTS_DIR}/spike-${TIMESTAMP}.csv" "Spike Test" 0
parse_results "${RESULTS_DIR}/stress-${TIMESTAMP}.csv" "Stress Test" 0

# Check if any scenario failed
FAILED=false
if ! parse_results "${RESULTS_DIR}/ramp-up-${TIMESTAMP}.csv" "Ramp-up Test" 0; then
  FAILED=true
fi
if ! parse_results "${RESULTS_DIR}/sustained-${TIMESTAMP}.csv" "Sustained Load" 10000; then
  FAILED=true
fi
if ! parse_results "${RESULTS_DIR}/spike-${TIMESTAMP}.csv" "Spike Test" 0; then
  FAILED=true
fi
if ! parse_results "${RESULTS_DIR}/stress-${TIMESTAMP}.csv" "Stress Test" 0; then
  FAILED=true
fi

echo "=========================================="
echo "Load Test Suite Completed"
echo "=========================================="
echo "All results saved to: ${RESULTS_DIR}/"
echo ""

# Exit with appropriate code
if [ "$FAILED" = true ]; then
  echo "❌ Load test targets NOT met!"
  exit 1
else
  echo "✅ All load test targets met!"
  exit 0
fi
