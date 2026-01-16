# Next Steps - Trading Engine & Market Data Service

## Quick Summary

All verification comments have been implemented and code has been updated with proper TypeScript types. The implementation is ready for testing and deployment.

## Immediate Actions Required

### 1. Install Dependencies
```bash
# Core Service
cd backend/core-service
bun install

# Market Data Service  
cd backend/market-data-service
bun install
```

### 2. Deploy Database Migration
```bash
cd backend/core-service
bunx prisma migrate deploy
```

This will apply timestamp-based partitioning to the `trades` and `positions` tables.

### 3. Verify Installation
```bash
# Check core-service builds
cd backend/core-service
bun build src/index.ts --outdir dist --target bun

# Check market-data-service builds
cd backend/market-data-service
bun build src/index.ts --outdir dist --target bun
```

## Testing Checklist

### Trading Engine
- [ ] POST /orders - Place an order and verify it succeeds
- [ ] GET /positions - Retrieve open positions
- [ ] GET /trades - Retrieve trade history
- [ ] Verify correlation IDs in logs and Kafka events
- [ ] Test drawdown violation (place order that exceeds max drawdown)
- [ ] Test risk limit violation (place order that exceeds max risk per trade)
- [ ] Test insufficient balance error
- [ ] Test market data unavailable error (503)

### Market Data Service
- [ ] Verify Polymarket GraphQL subscription receives market updates
- [ ] Verify event status polling detects cancellations
- [ ] Check `/metrics` endpoint returns non-zero publish counts
- [ ] Check `/ready` endpoint includes Kafka and ingestor health
- [ ] Verify Coingecko failover works correctly
- [ ] Verify circuit breaker state changes are reflected in metrics

## Key Files to Review

### Trading Engine
- `backend/core-service/src/routes/trading.ts` - REST endpoints with auth
- `backend/core-service/src/sagas/order-placement-saga.ts` - Order placement logic
- `backend/core-service/docs/TRADING_ENGINE.md` - Complete documentation

### Market Data Service
- `backend/market-data-service/src/ingestors/polymarket.ts` - Polymarket ingestor
- `backend/market-data-service/src/ingestors/coingecko.ts` - Coingecko ingestor
- `backend/market-data-service/src/ingestors/kalshi.ts` - Kalshi ingestor

## Verification Documents

- `backend/IMPLEMENTATION_STATUS.md` - Complete implementation status
- `backend/core-service/VERIFICATION_FIXES_TRADING.md` - Trading engine fixes
- `backend/market-data-service/VERIFICATION_FIXES_7.md` - Market data fixes (Round 2)
- `backend/market-data-service/VERIFICATION_FIXES_8.md` - Market data fixes (Round 3)

## Environment Setup

Ensure the following environment variables are configured:

### Core Service
```bash
JWT_SECRET=your-secret-key
DATABASE_URL=postgresql://user:password@host:5432/db
REDIS_URL=redis://host:6379
KAFKA_BROKERS=broker1:9092,broker2:9092
CRYPTO_SLIPPAGE_PERCENT=0.001
CRYPTO_FEE_PERCENT=0.001
PREDICTION_SLIPPAGE_PERCENT=0.002
PREDICTION_FEE_PERCENT=0.002
```

### Market Data Service
```bash
DATABASE_URL=postgresql://user:password@host:5432/db
REDIS_URL=redis://host:6379
KAFKA_BROKERS=broker1:9092,broker2:9092
COINGECKO_API_KEY=optional
COINMARKETCAP_API_KEY=optional
POLYMARKET_WS_URL=wss://gamma-api.polymarket.com/graphql
KALSHI_WS_URL=wss://api.kalshi.com/ws
```

## Troubleshooting

### TypeScript Errors After Installation
If you still see module resolution errors after running `bun install`, try:
```bash
bun install --force
```

### Database Migration Issues
If migration fails, check:
1. Database is CockroachDB (migration uses CockroachDB syntax)
2. Database connection is working
3. User has permissions to create partitions

### Kafka Connection Issues
Verify Kafka brokers are accessible:
```bash
# Test connection
nc -zv broker1 9092
```

### Redis Connection Issues
Verify Redis is accessible:
```bash
# Test connection
redis-cli ping
```

## Performance Monitoring

After deployment, monitor these metrics:

- Order placement latency (target: p99 < 10ms)
- Position fetch latency (target: p99 < 50ms)
- Trade history fetch latency (target: p99 < 100ms)
- Kafka publish latency (target: p99 < 100ms)
- Order success rate (target: > 99%)
- Drawdown violation frequency (monitor for anomalies)

## Support

For issues or questions:
1. Check the documentation in `backend/core-service/docs/TRADING_ENGINE.md`
2. Review verification fix documents for implementation details
3. Check logs for correlation IDs to trace requests through the system
4. Verify environment variables are correctly configured

