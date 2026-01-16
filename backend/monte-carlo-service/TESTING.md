# Monte Carlo Service Testing Guide

This guide covers testing strategies for the Monte Carlo Service, including unit tests, integration tests, and mocking external dependencies.

## Test Structure

The test suite is organized into three categories:

### 1. Unit Tests (`tests/unit.test.ts`)

Unit tests validate individual components in isolation using mocks for external dependencies.

**Coverage:**
- Job Manager logic (create, execute, list jobs)
- Ray Serve client input/output validation
- Core Service client data fetching
- Configuration parsing
- Logger functionality

**Run unit tests:**
```bash
cd backend/monte-carlo-service
bun test tests/unit.test.ts
```

### 2. Integration Tests (`tests/integration.test.ts`)

Integration tests validate the service API endpoints and error handling. These tests are designed to work with or without live dependencies.

**Features:**
- Service availability detection
- Graceful degradation when dependencies are unavailable
- HTTP status code validation
- Error handling verification

**Run integration tests:**
```bash
cd backend/monte-carlo-service
bun test tests/integration.test.ts
```

**With live service:**
```bash
# Start the service first
bun run src/index.ts &

# Run tests
bun test tests/integration.test.ts
```

### 3. Mock Utilities (`tests/mocks.ts`)

Provides test doubles for external dependencies:
- Ray Serve client mock
- Core Service client mock
- Kafka producer mock
- Redis client mock
- Prisma client mock
- Test data generators

## Running All Tests

```bash
cd backend/monte-carlo-service
bun test
```

## Test Scenarios

### Scenario 1: Service Not Available

When the Monte Carlo Service is not running, integration tests gracefully skip:

```
✓ should return health status (skipped: service not available)
✓ should return ready status when dependencies are available (skipped: service not available)
✓ should return error when neither assessmentId nor fundedAccountId provided (skipped: service not available)
```

### Scenario 2: Service Available, Dependencies Missing

When the service is running but external dependencies (Redis, Kafka, DB, Ray Serve) are unavailable:

```
✓ should return health status
✓ should return ready status when dependencies are available (readiness check fails as expected)
✓ should return error when neither assessmentId nor fundedAccountId provided
✓ should handle non-existent job gracefully
✓ should list simulation jobs (fails with 500 if DB unavailable)
```

### Scenario 3: Full Stack Available

When all dependencies are running:

```
✓ should return health status
✓ should return ready status when dependencies are available
✓ should return error when neither assessmentId nor fundedAccountId provided
✓ should handle non-existent job gracefully
✓ should list simulation jobs
✓ should validate HTTP status codes on errors
```

## Using Mocks in Tests

### Example: Testing with Ray Serve Mock

```typescript
import { mockRayServeClient } from "./mocks";

// Use mock instead of real Ray Serve
const result = await mockRayServeClient.callRayServeSimulation({
  tradeHistory: [],
  pnlData: { balance: 100000, peak: 100000, realized: 0, unrealized: 0 },
});

expect(result.pathsSimulated).toBe(1000000);
```

### Example: Testing with Core Service Mock

```typescript
import { mockCoreServiceClient } from "./mocks";

// Use mock instead of real Core Service
const assessment = await mockCoreServiceClient.fetchAssessmentData("test-id");

expect(assessment.status).toBe("passed");
expect(assessment.virtualAccount.balance).toBe(100000);
```

### Example: Generating Test Data

```typescript
import { testDataGenerators } from "./mocks";

// Generate simulation input with defaults
const input = testDataGenerators.generateSimulationInput();

// Generate with custom values
const customInput = testDataGenerators.generateSimulationInput({
  pnlData: { balance: 250000, peak: 260000, realized: 10000, unrealized: 5000 },
});
```

## Test Coverage Goals

- **Unit Tests**: 80%+ coverage of business logic
- **Integration Tests**: All API endpoints and error paths
- **Error Handling**: 404, 400, 500 status codes
- **Data Validation**: Input validation and output structure

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: cd backend/monte-carlo-service && bun install
      - run: cd backend/monte-carlo-service && bun test
```

## Debugging Tests

### Enable Verbose Logging

```bash
DEBUG=* bun test
```

### Run Single Test

```bash
bun test tests/unit.test.ts --grep "should validate simulation result structure"
```

### Watch Mode

```bash
bun test --watch
```

## Performance Testing

### Load Testing Ray Serve

```bash
# Generate 100 concurrent simulation requests
for i in {1..100}; do
  curl -X POST http://localhost:8000/simulate \
    -H "Content-Type: application/json" \
    -d '{"tradeHistory":[],"pnlData":{"balance":100000,"peak":100000,"realized":0,"unrealized":0}}' &
done
wait
```

### Stress Testing Service

```bash
# Generate 50 concurrent API requests
for i in {1..50}; do
  curl -X POST http://localhost:3002/simulations \
    -H "Content-Type: application/json" \
    -d '{"assessmentId":"test-'$i'"}' &
done
wait
```

## Troubleshooting

### Tests Fail with "Service not available"

This is expected when the service is not running. Start the service:

```bash
bun run src/index.ts
```

### Tests Fail with Database Errors

Ensure database migrations are applied:

```bash
bun run db:migrate
```

### Tests Fail with Kafka Errors

Ensure Kafka is running and accessible:

```bash
kafka-broker-api-versions --bootstrap-server localhost:9092
```

### Tests Fail with Redis Errors

Ensure Redis is running and accessible:

```bash
redis-cli ping
```

## Best Practices

1. **Use mocks for external dependencies** - Keeps tests fast and reliable
2. **Test error paths** - Verify 400, 404, 500 status codes
3. **Use test data generators** - Reduces boilerplate and improves maintainability
4. **Skip tests gracefully** - Don't fail when dependencies are unavailable
5. **Document test scenarios** - Help other developers understand test coverage
6. **Run tests in CI/CD** - Catch regressions early

## Next Steps

1. Add E2E tests with Docker Compose for full stack testing
2. Add performance benchmarks for simulation execution
3. Add mutation testing to verify test quality
4. Add coverage reports to CI/CD pipeline
