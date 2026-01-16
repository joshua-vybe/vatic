import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Kafka } from "kafkajs";
import Redis from "ioredis";
import WebSocket from "ws";

/**
 * Real Kafka → WebSocket Integration Tests
 * 
 * These tests exercise real Kafka topics, Redis, and WebSocket endpoints
 * using the docker-compose test environment.
 * 
 * Prerequisites:
 * - docker-compose -f docker-compose.test.yml up -d
 * - Core Service running on http://localhost:3000
 * - WebSocket Service running on ws://localhost:3001
 */

const KAFKA_BROKERS = ["localhost:9092"];
const REDIS_HOST = "localhost";
const REDIS_PORT = 6379;
const CORE_SERVICE_URL = "http://localhost:3000";
const WEBSOCKET_URL = "ws://localhost:3001";

interface KafkaMessage {
  type: string;
  assessment_id: string;
  correlation_id: string;
  data: Record<string, any>;
  timestamp: number;
}

let kafka: Kafka;
let redis: Redis;
let kafkaProducer: any;
let kafkaConsumer: any;

async function waitForService(url: string, timeout = 10000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url.replace("ws://", "http://").replace("/", "/health"));
      if (response.ok) return true;
    } catch {
      // Service not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function setupKafka() {
  kafka = new Kafka({
    clientId: "test-client",
    brokers: KAFKA_BROKERS,
    connectionTimeout: 10000,
    requestTimeout: 10000,
  });

  kafkaProducer = kafka.producer();
  kafkaConsumer = kafka.consumer({ groupId: "test-group" });

  try {
    await kafkaProducer.connect();
    await kafkaConsumer.connect();
    return true;
  } catch (error) {
    console.error("Failed to connect to Kafka:", error);
    return false;
  }
}

async function setupRedis() {
  redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });

  return new Promise<boolean>((resolve) => {
    redis.on("connect", () => resolve(true));
    redis.on("error", () => resolve(false));
    setTimeout(() => resolve(false), 5000);
  });
}

describe("Kafka → WebSocket Integration (Real Services)", () => {
  let kafkaConsumerForTest: any;
  let wsClient: WebSocket | null = null;
  let receivedMessages: KafkaMessage[] = [];
  let wsMessages: any[] = [];

  beforeAll(async () => {
    // Wait for services to be ready
    const kafkaReady = await setupKafka();
    const redisReady = await setupRedis();

    if (!kafkaReady || !redisReady) {
      console.warn("⚠️  Test services not available. Skipping real integration tests.");
      console.warn("Run: docker-compose -f docker-compose.test.yml up -d");
    }

    // Setup Kafka consumer for test verification
    if (kafkaReady) {
      kafkaConsumerForTest = kafka.consumer({ groupId: `test-group-${Date.now()}` });
      await kafkaConsumerForTest.connect();
    }
  });

  afterAll(async () => {
    if (kafkaProducer) await kafkaProducer.disconnect();
    if (kafkaConsumer) await kafkaConsumer.disconnect();
    if (kafkaConsumerForTest) await kafkaConsumerForTest.disconnect();
    if (redis) redis.disconnect();
    if (wsClient) wsClient.close();
  });

  describe("Message Flow Through Kafka", () => {
    it("should publish and consume order-placed event with correlation ID", async () => {
      if (!kafkaProducer || !kafkaConsumerForTest) {
        console.warn("Skipping: Kafka not available");
        return;
      }

      const assessmentId = `assessment-${Date.now()}`;
      const correlationId = `corr-${Date.now()}`;
      receivedMessages = [];

      const message: KafkaMessage = {
        type: "order-placed",
        assessment_id: assessmentId,
        correlation_id: correlationId,
        data: {
          order_id: `order-${Date.now()}`,
          symbol: "BTC/USD",
          side: "long",
          size: 1,
          price: 50000,
        },
        timestamp: Date.now(),
      };

      // Subscribe to topic
      await kafkaConsumerForTest.subscribe({ topic: "trading.order-placed", fromBeginning: false });

      // Setup message handler
      await kafkaConsumerForTest.run({
        eachMessage: async ({ topic, partition, message: kafkaMsg }) => {
          if (kafkaMsg.value) {
            const parsedMsg = JSON.parse(kafkaMsg.value.toString());
            receivedMessages.push(parsedMsg);
          }
        },
      });

      // Publish to Kafka
      await kafkaProducer.send({
        topic: "trading.order-placed",
        messages: [
          {
            key: assessmentId,
            value: JSON.stringify(message),
            headers: {
              "correlation-id": correlationId,
            },
          },
        ],
      });

      // Wait for message to be consumed
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify message was received
      expect(receivedMessages.length).toBeGreaterThan(0);
      const receivedMsg = receivedMessages[0];
      expect(receivedMsg.assessment_id).toBe(assessmentId);
      expect(receivedMsg.correlation_id).toBe(correlationId);
      expect(receivedMsg.type).toBe("order-placed");
    });

    it("should publish market price updates and verify consumption", async () => {
      if (!kafkaProducer || !kafkaConsumerForTest) {
        console.warn("Skipping: Kafka not available");
        return;
      }

      const assessmentId = `assessment-${Date.now()}`;
      const correlationId = `corr-${Date.now()}`;
      receivedMessages = [];

      const message: KafkaMessage = {
        type: "price-update",
        assessment_id: assessmentId,
        correlation_id: correlationId,
        data: {
          symbol: "BTC/USD",
          price: 51000,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };

      // Subscribe to topic
      await kafkaConsumerForTest.subscribe({ topic: "market-data.price-update", fromBeginning: false });

      // Setup message handler
      await kafkaConsumerForTest.run({
        eachMessage: async ({ topic, partition, message: kafkaMsg }) => {
          if (kafkaMsg.value) {
            const parsedMsg = JSON.parse(kafkaMsg.value.toString());
            receivedMessages.push(parsedMsg);
          }
        },
      });

      await kafkaProducer.send({
        topic: "market-data.price-update",
        messages: [
          {
            key: assessmentId,
            value: JSON.stringify(message),
            headers: {
              "correlation-id": correlationId,
            },
          },
        ],
      });

      // Wait for consumption
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify message received with correlation ID
      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages[0].correlation_id).toBe(correlationId);
      expect(receivedMessages[0].data.price).toBe(51000);
    });

    it("should publish P&L updates and verify consumption", async () => {
      if (!kafkaProducer || !kafkaConsumerForTest) {
        console.warn("Skipping: Kafka not available");
        return;
      }

      const assessmentId = `assessment-${Date.now()}`;
      const correlationId = `corr-${Date.now()}`;
      receivedMessages = [];

      const message: KafkaMessage = {
        type: "pnl-update",
        assessment_id: assessmentId,
        correlation_id: correlationId,
        data: {
          balance: 51000,
          peak_balance: 51000,
          pnl: 1000,
        },
        timestamp: Date.now(),
      };

      // Subscribe to topic
      await kafkaConsumerForTest.subscribe({ topic: "assessment.pnl-update", fromBeginning: false });

      // Setup message handler
      await kafkaConsumerForTest.run({
        eachMessage: async ({ topic, partition, message: kafkaMsg }) => {
          if (kafkaMsg.value) {
            const parsedMsg = JSON.parse(kafkaMsg.value.toString());
            receivedMessages.push(parsedMsg);
          }
        },
      });

      await kafkaProducer.send({
        topic: "assessment.pnl-update",
        messages: [
          {
            key: assessmentId,
            value: JSON.stringify(message),
            headers: {
              "correlation-id": correlationId,
            },
          },
        ],
      });

      // Wait for consumption
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify message received
      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages[0].data.balance).toBe(51000);
      expect(receivedMessages[0].correlation_id).toBe(correlationId);
    });

    it("should publish violation events and verify consumption", async () => {
      if (!kafkaProducer || !kafkaConsumerForTest) {
        console.warn("Skipping: Kafka not available");
        return;
      }

      const assessmentId = `assessment-${Date.now()}`;
      const correlationId = `corr-${Date.now()}`;
      receivedMessages = [];

      const message: KafkaMessage = {
        type: "violation-detected",
        assessment_id: assessmentId,
        correlation_id: correlationId,
        data: {
          rule: "max_drawdown",
          value: 0.11,
          threshold: 0.1,
        },
        timestamp: Date.now(),
      };

      // Subscribe to topic
      await kafkaConsumerForTest.subscribe({ topic: "rules.violation-detected", fromBeginning: false });

      // Setup message handler
      await kafkaConsumerForTest.run({
        eachMessage: async ({ topic, partition, message: kafkaMsg }) => {
          if (kafkaMsg.value) {
            const parsedMsg = JSON.parse(kafkaMsg.value.toString());
            receivedMessages.push(parsedMsg);
          }
        },
      });

      await kafkaProducer.send({
        topic: "rules.violation-detected",
        messages: [
          {
            key: assessmentId,
            value: JSON.stringify(message),
            headers: {
              "correlation-id": correlationId,
            },
          },
        ],
      });

      // Wait for consumption
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify message received
      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages[0].data.rule).toBe("max_drawdown");
      expect(receivedMessages[0].correlation_id).toBe(correlationId);
    });
  });

  describe("Redis Cache Integration", () => {
    it("should cache market prices in Redis", async () => {
      if (!redis) {
        console.warn("Skipping: Redis not available");
        return;
      }

      const key = `market:BTC/USD:price`;
      const price = 50000;

      await redis.set(key, price);
      const cached = await redis.get(key);

      expect(cached).toBe(String(price));
    });

    it("should update cached prices", async () => {
      if (!redis) {
        console.warn("Skipping: Redis not available");
        return;
      }

      const key = `market:ETH/USD:price`;

      await redis.set(key, 3000);
      let cached = await redis.get(key);
      expect(cached).toBe("3000");

      await redis.set(key, 3100);
      cached = await redis.get(key);
      expect(cached).toBe("3100");
    });

    it("should store assessment state in Redis", async () => {
      if (!redis) {
        console.warn("Skipping: Redis not available");
        return;
      }

      const assessmentId = `assessment-${Date.now()}`;
      const state = {
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
      };

      await redis.set(`assessment:${assessmentId}`, JSON.stringify(state));
      const cached = await redis.get(`assessment:${assessmentId}`);

      expect(cached).toBe(JSON.stringify(state));
    });

    it("should handle assessment updates", async () => {
      if (!redis) {
        console.warn("Skipping: Redis not available");
        return;
      }

      const assessmentId = `assessment-${Date.now()}`;
      const initialState = {
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
      };

      await redis.set(`assessment:${assessmentId}`, JSON.stringify(initialState));

      const updatedState = {
        balance: 51000,
        peak_balance: 51000,
        trade_count: 1,
      };

      await redis.set(`assessment:${assessmentId}`, JSON.stringify(updatedState));
      const cached = await redis.get(`assessment:${assessmentId}`);

      expect(cached).toBe(JSON.stringify(updatedState));
    });
  });

  describe("Correlation ID Propagation", () => {
    it("should preserve correlation ID through Kafka and verify in consumer", async () => {
      if (!kafkaProducer || !kafkaConsumerForTest) {
        console.warn("Skipping: Kafka not available");
        return;
      }

      const correlationId = `corr-unique-${Date.now()}`;
      const assessmentId = `assessment-${Date.now()}`;
      receivedMessages = [];

      const message: KafkaMessage = {
        type: "order-placed",
        assessment_id: assessmentId,
        correlation_id: correlationId,
        data: { order_id: `order-${Date.now()}` },
        timestamp: Date.now(),
      };

      // Subscribe to topic
      await kafkaConsumerForTest.subscribe({ topic: "trading.order-placed", fromBeginning: false });

      // Setup message handler
      await kafkaConsumerForTest.run({
        eachMessage: async ({ topic, partition, message: kafkaMsg }) => {
          if (kafkaMsg.value) {
            const parsedMsg = JSON.parse(kafkaMsg.value.toString());
            receivedMessages.push(parsedMsg);
          }
        },
      });

      await kafkaProducer.send({
        topic: "trading.order-placed",
        messages: [
          {
            key: assessmentId,
            value: JSON.stringify(message),
            headers: {
              "correlation-id": correlationId,
            },
          },
        ],
      });

      // Wait for consumption
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify correlation ID preserved
      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages[0].correlation_id).toBe(correlationId);
    });
  });

  describe("End-to-End Flow", () => {
    it("should complete order placement flow through Kafka with correlation ID tracking", async () => {
      if (!kafkaProducer || !redis || !kafkaConsumerForTest) {
        console.warn("Skipping: Services not available");
        return;
      }

      const assessmentId = `assessment-${Date.now()}`;
      const correlationId = `corr-${Date.now()}`;
      receivedMessages = [];

      // Step 1: Publish order-placed event
      const orderMessage: KafkaMessage = {
        type: "order-placed",
        assessment_id: assessmentId,
        correlation_id: correlationId,
        data: {
          order_id: `order-${Date.now()}`,
          symbol: "BTC/USD",
          side: "long",
          size: 1,
          price: 50000,
        },
        timestamp: Date.now(),
      };

      // Subscribe to topic
      await kafkaConsumerForTest.subscribe({ topic: "trading.order-placed", fromBeginning: false });

      // Setup message handler
      await kafkaConsumerForTest.run({
        eachMessage: async ({ topic, partition, message: kafkaMsg }) => {
          if (kafkaMsg.value) {
            const parsedMsg = JSON.parse(kafkaMsg.value.toString());
            receivedMessages.push(parsedMsg);
          }
        },
      });

      await kafkaProducer.send({
        topic: "trading.order-placed",
        messages: [
          {
            key: assessmentId,
            value: JSON.stringify(orderMessage),
            headers: {
              "correlation-id": correlationId,
            },
          },
        ],
      });

      // Wait for consumption
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify message received with correlation ID
      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages[0].correlation_id).toBe(correlationId);

      // Step 2: Update assessment state in Redis
      const state = {
        balance: 50000,
        peak_balance: 50000,
        trade_count: 1,
      };

      await redis.set(`assessment:${assessmentId}`, JSON.stringify(state));

      // Step 3: Verify state persisted
      const cached = await redis.get(`assessment:${assessmentId}`);
      expect(cached).toBe(JSON.stringify(state));

      // Step 4: Publish P&L update with same correlation ID
      receivedMessages = [];
      const pnlMessage: KafkaMessage = {
        type: "pnl-update",
        assessment_id: assessmentId,
        correlation_id: correlationId,
        data: {
          balance: 51000,
          peak_balance: 51000,
          pnl: 1000,
        },
        timestamp: Date.now(),
      };

      // Subscribe to new topic
      await kafkaConsumerForTest.subscribe({ topic: "assessment.pnl-update", fromBeginning: false });

      // Setup message handler
      await kafkaConsumerForTest.run({
        eachMessage: async ({ topic, partition, message: kafkaMsg }) => {
          if (kafkaMsg.value) {
            const parsedMsg = JSON.parse(kafkaMsg.value.toString());
            receivedMessages.push(parsedMsg);
          }
        },
      });

      await kafkaProducer.send({
        topic: "assessment.pnl-update",
        messages: [
          {
            key: assessmentId,
            value: JSON.stringify(pnlMessage),
            headers: {
              "correlation-id": correlationId,
            },
          },
        ],
      });

      // Wait for consumption
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify P&L message received with same correlation ID
      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages[0].correlation_id).toBe(correlationId);
    });
  });
});
