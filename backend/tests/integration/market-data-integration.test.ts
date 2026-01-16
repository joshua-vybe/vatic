import { describe, it, expect, beforeAll, afterAll } from "bun:test";

interface MarketData {
  symbol: string;
  price: number;
  timestamp: number;
}

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

class MockMarketDataAPI {
  private shouldFail = false;

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  async fetchPrice(symbol: string): Promise<number> {
    if (this.shouldFail) {
      throw new Error("API unavailable");
    }
    // Mock prices
    const prices: Record<string, number> = {
      "BTC/USD": 50000,
      "ETH/USD": 3000,
      "polymarket:event-123": 0.6,
    };
    return prices[symbol] || 0;
  }
}

class CircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    isOpen: false,
  };
  private failureThreshold = 3;
  private resetTimeout = 5000; // 5 seconds

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.isOpen) {
      const timeSinceLastFailure = Date.now() - this.state.lastFailureTime;
      if (timeSinceLastFailure > this.resetTimeout) {
        this.state.isOpen = false;
        this.state.failures = 0;
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.state.failures = 0;
      return result;
    } catch (error) {
      this.state.failures++;
      this.state.lastFailureTime = Date.now();

      if (this.state.failures >= this.failureThreshold) {
        this.state.isOpen = true;
      }

      throw error;
    }
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }
}

class MockKafkaProducer {
  private messages: Array<{ topic: string; data: any }> = [];

  async publish(topic: string, data: any): Promise<void> {
    this.messages.push({ topic, data });
  }

  getMessages(topic?: string): Array<{ topic: string; data: any }> {
    return topic ? this.messages.filter((m) => m.topic === topic) : this.messages;
  }

  clear(): void {
    this.messages = [];
  }
}

class MockRedisCache {
  private cache: Map<string, any> = new Map();

  async set(key: string, value: any): Promise<void> {
    this.cache.set(key, value);
  }

  async get(key: string): Promise<any> {
    return this.cache.get(key) || null;
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getAll(): Map<string, any> {
    return new Map(this.cache);
  }
}

describe("Market Data → Kafka → Core Integration", () => {
  let api: MockMarketDataAPI;
  let circuitBreaker: CircuitBreaker;
  let kafka: MockKafkaProducer;
  let redis: MockRedisCache;

  beforeAll(() => {
    api = new MockMarketDataAPI();
    circuitBreaker = new CircuitBreaker();
    kafka = new MockKafkaProducer();
    redis = new MockRedisCache();
  });

  afterAll(() => {
    kafka.clear();
    redis.clear();
  });

  describe("Market Data Ingestion", () => {
    it("should fetch market data from API", async () => {
      const price = await api.fetchPrice("BTC/USD");
      expect(price).toBe(50000);
    });

    it("should handle multiple market symbols", async () => {
      const btcPrice = await api.fetchPrice("BTC/USD");
      const ethPrice = await api.fetchPrice("ETH/USD");
      const polyPrice = await api.fetchPrice("polymarket:event-123");

      expect(btcPrice).toBe(50000);
      expect(ethPrice).toBe(3000);
      expect(polyPrice).toBe(0.6);
    });

    it("should detect market type from symbol", () => {
      const isCrypto = (symbol: string) => !symbol.includes("polymarket:") && !symbol.includes("kalshi:");
      expect(isCrypto("BTC/USD")).toBe(true);
      expect(isCrypto("polymarket:event-123")).toBe(false);
    });
  });

  describe("Kafka Publishing", () => {
    it("should publish market data to Kafka", async () => {
      const price = await api.fetchPrice("BTC/USD");
      await kafka.publish("market-data.btc-ticks", {
        symbol: "BTC/USD",
        price,
        timestamp: Date.now(),
      });

      const messages = kafka.getMessages("market-data.btc-ticks");
      expect(messages.length).toBe(1);
      expect(messages[0].data.price).toBe(50000);
    });

    it("should publish multiple market data topics", async () => {
      const btcPrice = await api.fetchPrice("BTC/USD");
      const ethPrice = await api.fetchPrice("ETH/USD");

      await kafka.publish("market-data.btc-ticks", { symbol: "BTC/USD", price: btcPrice });
      await kafka.publish("market-data.eth-ticks", { symbol: "ETH/USD", price: ethPrice });

      expect(kafka.getMessages("market-data.btc-ticks").length).toBe(1);
      expect(kafka.getMessages("market-data.eth-ticks").length).toBe(1);
    });
  });

  describe("Redis Cache Updates", () => {
    it("should cache market prices in Redis", async () => {
      const price = await api.fetchPrice("BTC/USD");
      await redis.set("market:BTC/USD:price", price);

      const cachedPrice = await redis.get("market:BTC/USD:price");
      expect(cachedPrice).toBe(50000);
    });

    it("should update cache on new price", async () => {
      await redis.set("market:BTC/USD:price", 50000);
      let cachedPrice = await redis.get("market:BTC/USD:price");
      expect(cachedPrice).toBe(50000);

      // Update price
      await redis.set("market:BTC/USD:price", 51000);
      cachedPrice = await redis.get("market:BTC/USD:price");
      expect(cachedPrice).toBe(51000);
    });

    it("should handle prediction market prices", async () => {
      const price = await api.fetchPrice("polymarket:event-123");
      await redis.set("market:polymarket:event-123:price", price);

      const cachedPrice = await redis.get("market:polymarket:event-123:price");
      expect(cachedPrice).toBe(0.6);
    });
  });

  describe("Circuit Breaker Failover", () => {
    it("should handle API failures gracefully", async () => {
      api.setShouldFail(true);

      try {
        await circuitBreaker.execute(() => api.fetchPrice("BTC/USD"));
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(String(error)).toContain("API unavailable");
      }

      api.setShouldFail(false);
    });

    it("should open circuit after threshold failures", async () => {
      api.setShouldFail(true);

      // Trigger 3 failures to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(() => api.fetchPrice("BTC/USD"));
        } catch {
          // Expected
        }
      }

      const state = circuitBreaker.getState();
      expect(state.isOpen).toBe(true);
      expect(state.failures).toBe(3);
    });

    it("should reject requests when circuit is open", async () => {
      api.setShouldFail(true);

      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(() => api.fetchPrice("BTC/USD"));
        } catch {
          // Expected
        }
      }

      // Try to execute with open circuit
      try {
        await circuitBreaker.execute(() => api.fetchPrice("BTC/USD"));
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(String(error)).toContain("Circuit breaker is open");
      }

      api.setShouldFail(false);
    });
  });

  describe("End-to-End Flow", () => {
    it("should complete market data ingestion flow", async () => {
      kafka.clear();
      redis.clear();

      // Step 1: Fetch from API
      const price = await api.fetchPrice("BTC/USD");
      expect(price).toBe(50000);

      // Step 2: Publish to Kafka
      await kafka.publish("market-data.btc-ticks", {
        symbol: "BTC/USD",
        price,
        timestamp: Date.now(),
      });

      // Step 3: Update Redis cache
      await redis.set("market:BTC/USD:price", price);

      // Verify all steps completed
      expect(kafka.getMessages("market-data.btc-ticks").length).toBe(1);
      expect(await redis.get("market:BTC/USD:price")).toBe(50000);
    });

    it("should handle multiple concurrent market updates", async () => {
      kafka.clear();
      redis.clear();

      const symbols = ["BTC/USD", "ETH/USD", "polymarket:event-123"];

      // Fetch and publish all markets concurrently
      await Promise.all(
        symbols.map(async (symbol) => {
          const price = await api.fetchPrice(symbol);
          const topic = symbol.includes("polymarket:") ? "market-data.polymarket-ticks" : "market-data.crypto-ticks";
          await kafka.publish(topic, { symbol, price, timestamp: Date.now() });
          await redis.set(`market:${symbol}:price`, price);
        })
      );

      // Verify all markets updated
      expect(kafka.getMessages().length).toBe(3);
      for (const symbol of symbols) {
        const cachedPrice = await redis.get(`market:${symbol}:price`);
        expect(cachedPrice).toBeGreaterThan(0);
      }
    });
  });
});
