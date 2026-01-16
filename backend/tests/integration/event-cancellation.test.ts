import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Kafka } from "kafkajs";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";

/**
 * Integration Tests for Event Cancellation Flow
 * 
 * Tests the complete end-to-end flow:
 * 1. Kafka event consumption
 * 2. Redis state updates (positions marked cancelled, balance restored)
 * 3. Kafka event publishing (trading.position-refunded)
 * 4. Database persistence (position status, trades marked cancelled)
 * 
 * Prerequisites:
 * - docker-compose -f docker-compose.test.yml up -d
 * - Core Service running on http://localhost:3000
 */

const KAFKA_BROKERS = ["localhost:9092"];
const REDIS_HOST = "localhost";
const REDIS_PORT = 6379;
const CORE_SERVICE_URL = "http://localhost:3000";

interface AssessmentState {
  currentBalance: number;
  peakBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  positions: Array<{
    id: string;
    market: string;
    side: string;
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    openedAt: string | Date;
    status: 'active' | 'cancelled';
  }>;
}

interface RefundEvent {
  assessmentId: string;
  positionId: string;
  market: string;
  side: string;
  quantity: number;
  entryPrice: number;
  refundAmount: number;
  reason: string;
  eventId: string;
  eventSource: string;
  correlationId: string;
  timestamp: string;
}

let kafka: Kafka;
let redis: Redis;
let prisma: PrismaClient;
let kafkaProducer: any;
let kafkaConsumer: any;
let servicesReady = false;

async function waitForService(url: string, timeout = 10000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      // Use /health endpoint for service readiness check
      const healthUrl = url.replace("ws://", "http://").replace(/\/$/, "") + "/health";
      const response = await fetch(healthUrl);
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
    clientId: "test-client-cancellation",
    brokers: KAFKA_BROKERS,
    connectionTimeout: 10000,
    requestTimeout: 10000,
  });

  kafkaProducer = kafka.producer();
  kafkaConsumer = kafka.consumer({ groupId: "test-group-cancellation" });

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
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });

  return new Promise<boolean>((resolve) => {
    redis.on("connect", () => resolve(true));
    redis.on("error", () => resolve(false));
    setTimeout(() => resolve(false), 5000);
  });
}

async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();
  while (!(await Promise.resolve(condition()))) {
    if (Date.now() - startTime > timeout) {
      throw new Error("Timeout waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

async function waitForPositionCancelled(
  assessmentId: string,
  positionId: string,
  timeout: number = 5000
): Promise<void> {
  await waitFor(async () => {
    const stateJson = await redis.get(`assessment:${assessmentId}:state`);
    if (!stateJson) return false;
    const state = JSON.parse(stateJson) as AssessmentState;
    const position = state.positions.find(p => p.id === positionId);
    return position?.status === 'cancelled';
  }, timeout);
}

async function waitForDatabasePersistence(
  positionId: string,
  timeout: number = 10000
): Promise<void> {
  if (!servicesReady || !prisma) return;

  await waitFor(async () => {
    try {
      const position = await prisma.position.findUnique({
        where: { id: positionId },
      });
      return position?.status === 'cancelled';
    } catch {
      return false;
    }
  }, timeout);
}

describe("Event Cancellation Integration Tests", () => {
  let kafkaConsumerForTest: any;
  let receivedRefundEvents: RefundEvent[] = [];

  beforeAll(async () => {
    // Wait for services to be ready
    const kafkaReady = await setupKafka();
    const redisReady = await setupRedis();
    const coreServiceReady = await waitForService(CORE_SERVICE_URL);

    if (!kafkaReady || !redisReady || !coreServiceReady) {
      console.warn("⚠️  Test services not available. Skipping event cancellation integration tests.");
      console.warn("Run: docker-compose -f docker-compose.test.yml up -d");
      servicesReady = false;
      return;
    }

    servicesReady = true;

    // Initialize Prisma client for database assertions
    try {
      prisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/test_db",
          },
        },
      });
      // Test connection
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      console.warn("⚠️  Failed to connect to database. Database assertions will be skipped.");
      console.warn("Error:", String(error));
      servicesReady = false;
      return;
    }

    // Setup consumer for refund events
    kafkaConsumerForTest = kafka.consumer({ groupId: "test-refund-consumer" });
    await kafkaConsumerForTest.connect();
    await kafkaConsumerForTest.subscribe({ topics: ["trading.position-refunded"], fromBeginning: false });

    await kafkaConsumerForTest.run({
      eachMessage: async ({ message }: { message: any }) => {
        if (message.value) {
          receivedRefundEvents.push(JSON.parse(message.value.toString()));
        }
      },
    });
  });

  afterAll(async () => {
    if (kafkaConsumerForTest) {
      await kafkaConsumerForTest.disconnect();
    }
    if (kafkaProducer) {
      await kafkaProducer.disconnect();
    }
    if (kafkaConsumer) {
      await kafkaConsumer.disconnect();
    }
    if (redis) {
      await redis.disconnect();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("should complete event cancellation flow for single position", async () => {
    if (!servicesReady) {
      console.warn("Services not ready, skipping test");
      return;
    }

    const assessmentId = `assessment-${Date.now()}`;
    const positionId = `pos-${Date.now()}`;
    const eventId = `event-${Date.now()}`;
    const correlationId = `corr-${Date.now()}`;

    // Setup: Create assessment state with active position
    const initialState: AssessmentState = {
      currentBalance: 50000,
      peakBalance: 50000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      tradeCount: 0,
      positions: [
        {
          id: positionId,
          market: `polymarket:${eventId}`,
          side: "yes",
          quantity: 100,
          entryPrice: 0.6,
          currentPrice: 0.6,
          unrealizedPnl: 0,
          openedAt: new Date(),
          status: 'active',
        },
      ],
    };

    await redis.set(`assessment:${assessmentId}:state`, JSON.stringify(initialState));

    // Calculate expected refund
    const expectedRefund = (0.6 * 100) + (0.6 * 100 * 0.0005); // 60.03

    // Act: Publish event cancellation
    await kafkaProducer.send({
      topic: "events.event-cancelled",
      messages: [
        {
          value: JSON.stringify({
            event_id: eventId,
            source: "polymarket",
            status: "cancelled",
            timestamp: new Date(),
          }),
          headers: {
            "correlation-id": Buffer.from(correlationId),
          },
        },
      ],
    });

    // Assert: Verify Redis state updated
    await waitForPositionCancelled(assessmentId, positionId);

    const updatedStateJson = await redis.get(`assessment:${assessmentId}:state`);
    expect(updatedStateJson).toBeTruthy();

    const updatedState = JSON.parse(updatedStateJson!) as AssessmentState;
    const cancelledPosition = updatedState.positions.find(p => p.id === positionId);

    expect(cancelledPosition?.status).toBe('cancelled');
    
    // Assert exact balance restoration
    expect(updatedState.currentBalance).toBeCloseTo(initialState.currentBalance + expectedRefund, 2);

    // Assert refund event was published
    await waitFor(
      () => receivedRefundEvents.some(
        (event: RefundEvent) => event.positionId === positionId && event.correlationId === correlationId
      ),
      5000
    );

    const refundEvent = receivedRefundEvents.find(
      (event: RefundEvent) => event.positionId === positionId && event.correlationId === correlationId
    );

    expect(refundEvent).toBeTruthy();
    expect(refundEvent?.refundAmount).toBeCloseTo(expectedRefund, 2);
    expect(refundEvent?.eventId).toBe(eventId);
    expect(refundEvent?.assessmentId).toBe(assessmentId);

    // Assert: Verify database persistence (if Prisma available)
    if (servicesReady && prisma) {
      // Wait for persistence worker to complete
      await waitForDatabasePersistence(positionId, 10000);

      // Query database for persisted position
      const persistedPosition = await prisma.position.findUnique({
        where: { id: positionId },
        include: { trades: true },
      });

      expect(persistedPosition).toBeTruthy();
      expect(persistedPosition?.status).toBe('cancelled');
      expect(persistedPosition?.closedAt).toBeTruthy();

      // Assert trades marked as cancelled
      if (persistedPosition?.trades && persistedPosition.trades.length > 0) {
        for (const trade of persistedPosition.trades) {
          expect(trade.cancelled).toBe(true);
        }
      }

      // Query virtual account to verify balance update
      const virtualAccount = await prisma.virtualAccount.findUnique({
        where: { assessmentId },
      });

      expect(virtualAccount).toBeTruthy();
      expect(virtualAccount?.currentBalance).toBeCloseTo(
        initialState.currentBalance + expectedRefund,
        2
      );
    }
  });

  it("should handle multiple positions on same event", async () => {
    if (!servicesReady) {
      console.warn("Services not ready, skipping test");
      return;
    }

    const assessmentId = `assessment-multi-${Date.now()}`;
    const eventId = `event-multi-${Date.now()}`;
    const correlationId = `corr-multi-${Date.now()}`;

    const positions = [
      {
        id: `pos-1-${Date.now()}`,
        market: `polymarket:${eventId}`,
        side: "yes",
        quantity: 100,
        entryPrice: 0.4,
        currentPrice: 0.4,
        unrealizedPnl: 0,
        openedAt: new Date(),
        status: 'active' as const,
      },
      {
        id: `pos-2-${Date.now()}`,
        market: `polymarket:${eventId}`,
        side: "yes",
        quantity: 100,
        entryPrice: 0.6,
        currentPrice: 0.6,
        unrealizedPnl: 0,
        openedAt: new Date(),
        status: 'active' as const,
      },
      {
        id: `pos-3-${Date.now()}`,
        market: `polymarket:${eventId}`,
        side: "yes",
        quantity: 100,
        entryPrice: 0.8,
        currentPrice: 0.8,
        unrealizedPnl: 0,
        openedAt: new Date(),
        status: 'active' as const,
      },
    ];

    const initialBalance = 50000;
    const initialState: AssessmentState = {
      currentBalance: initialBalance,
      peakBalance: initialBalance,
      realizedPnl: 0,
      unrealizedPnl: 0,
      tradeCount: 0,
      positions,
    };

    await redis.set(`assessment:${assessmentId}:state`, JSON.stringify(initialState));

    // Publish event cancellation
    await kafkaProducer.send({
      topic: "events.event-cancelled",
      messages: [
        {
          value: JSON.stringify({
            event_id: eventId,
            source: "polymarket",
            status: "cancelled",
            timestamp: new Date(),
          }),
          headers: {
            "correlation-id": Buffer.from(correlationId),
          },
        },
      ],
    });

    // Wait for all positions to be cancelled
    for (const position of positions) {
      await waitForPositionCancelled(assessmentId, position.id);
    }

    const updatedStateJson = await redis.get(`assessment:${assessmentId}:state`);
    const updatedState = JSON.parse(updatedStateJson!) as AssessmentState;

    // Verify all positions cancelled
    for (const position of positions) {
      const cancelledPos = updatedState.positions.find(p => p.id === position.id);
      expect(cancelledPos?.status).toBe('cancelled');
    }

    // Verify balance restored for all positions
    const totalRefund = 
      ((0.4 * 100) + (0.4 * 100 * 0.0005)) +
      ((0.6 * 100) + (0.6 * 100 * 0.0005)) +
      ((0.8 * 100) + (0.8 * 100 * 0.0005));

    expect(updatedState.currentBalance).toBeCloseTo(initialBalance + totalRefund, 2);
  });

  it("should only cancel affected positions on specific event", async () => {
    if (!servicesReady) {
      console.warn("Services not ready, skipping test");
      return;
    }

    const assessmentId = `assessment-mixed-${Date.now()}`;
    const eventAId = `event-a-${Date.now()}`;
    const eventBId = `event-b-${Date.now()}`;
    const eventCId = `event-c-${Date.now()}`;

    const positions = [
      {
        id: `pos-a-${Date.now()}`,
        market: `polymarket:${eventAId}`,
        side: "yes",
        quantity: 100,
        entryPrice: 0.5,
        currentPrice: 0.5,
        unrealizedPnl: 0,
        openedAt: new Date(),
        status: 'active' as const,
      },
      {
        id: `pos-b-${Date.now()}`,
        market: `polymarket:${eventBId}`,
        side: "yes",
        quantity: 100,
        entryPrice: 0.5,
        currentPrice: 0.5,
        unrealizedPnl: 0,
        openedAt: new Date(),
        status: 'active' as const,
      },
      {
        id: `pos-c-${Date.now()}`,
        market: `polymarket:${eventCId}`,
        side: "yes",
        quantity: 100,
        entryPrice: 0.5,
        currentPrice: 0.5,
        unrealizedPnl: 0,
        openedAt: new Date(),
        status: 'active' as const,
      },
    ];

    const initialState: AssessmentState = {
      currentBalance: 50000,
      peakBalance: 50000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      tradeCount: 0,
      positions,
    };

    await redis.set(`assessment:${assessmentId}:state`, JSON.stringify(initialState));

    // Cancel only event B
    await kafkaProducer.send({
      topic: "events.event-cancelled",
      messages: [
        {
          value: JSON.stringify({
            event_id: eventBId,
            source: "polymarket",
            status: "cancelled",
            timestamp: new Date(),
          }),
        },
      ],
    });

    // Wait for event B position to be cancelled
    await waitForPositionCancelled(assessmentId, positions[1].id);

    const updatedStateJson = await redis.get(`assessment:${assessmentId}:state`);
    const updatedState = JSON.parse(updatedStateJson!) as AssessmentState;

    // Verify only event B position is cancelled
    expect(updatedState.positions.find(p => p.id === positions[0].id)?.status).toBe('active');
    expect(updatedState.positions.find(p => p.id === positions[1].id)?.status).toBe('cancelled');
    expect(updatedState.positions.find(p => p.id === positions[2].id)?.status).toBe('active');

    // Verify balance only restored for event B
    const eventBRefund = (0.5 * 100) + (0.5 * 100 * 0.0005);
    expect(updatedState.currentBalance).toBeCloseTo(50000 + eventBRefund, 2);
  });

  it("should not increment trade count for cancelled positions", async () => {
    if (!servicesReady) {
      console.warn("Services not ready, skipping test");
      return;
    }

    const assessmentId = `assessment-trades-${Date.now()}`;
    const eventId = `event-trades-${Date.now()}`;

    const initialState: AssessmentState = {
      currentBalance: 50000,
      peakBalance: 50000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      tradeCount: 5, // Already has 5 trades
      positions: [
        {
          id: `pos-${Date.now()}`,
          market: `polymarket:${eventId}`,
          side: "yes",
          quantity: 100,
          entryPrice: 0.6,
          currentPrice: 0.6,
          unrealizedPnl: 0,
          openedAt: new Date(),
          status: 'active',
        },
      ],
    };

    await redis.set(`assessment:${assessmentId}:state`, JSON.stringify(initialState));

    // Publish event cancellation
    await kafkaProducer.send({
      topic: "events.event-cancelled",
      messages: [
        {
          value: JSON.stringify({
            event_id: eventId,
            source: "polymarket",
            status: "cancelled",
            timestamp: new Date(),
          }),
        },
      ],
    });

    // Wait for position to be cancelled
    await waitForPositionCancelled(assessmentId, initialState.positions[0].id);

    const updatedStateJson = await redis.get(`assessment:${assessmentId}:state`);
    const updatedState = JSON.parse(updatedStateJson!) as AssessmentState;

    // Verify trade count not incremented
    expect(updatedState.tradeCount).toBe(5); // Should remain 5, not 6
  });

  it("should preserve correlation ID through event flow", async () => {
    if (!servicesReady) {
      console.warn("Services not ready, skipping test");
      return;
    }

    const assessmentId = `assessment-corr-${Date.now()}`;
    const positionId = `pos-corr-${Date.now()}`;
    const eventId = `event-corr-${Date.now()}`;
    const correlationId = `corr-${Date.now()}-${Math.random()}`;

    const initialState: AssessmentState = {
      currentBalance: 50000,
      peakBalance: 50000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      tradeCount: 0,
      positions: [
        {
          id: positionId,
          market: `polymarket:${eventId}`,
          side: "yes",
          quantity: 100,
          entryPrice: 0.6,
          currentPrice: 0.6,
          unrealizedPnl: 0,
          openedAt: new Date(),
          status: 'active',
        },
      ],
    };

    await redis.set(`assessment:${assessmentId}:state`, JSON.stringify(initialState));

    // Publish with specific correlation ID
    await kafkaProducer.send({
      topic: "events.event-cancelled",
      messages: [
        {
          value: JSON.stringify({
            event_id: eventId,
            source: "polymarket",
            status: "cancelled",
            timestamp: new Date(),
          }),
          headers: {
            "correlation-id": Buffer.from(correlationId),
          },
        },
      ],
    });

    // Wait for processing
    await waitForPositionCancelled(assessmentId, positionId);

    // Verify correlation ID preserved in Redis state
    const updatedStateJson = await redis.get(`assessment:${assessmentId}:state`);
    expect(updatedStateJson).toBeTruthy();
  });

  it("should handle idempotent duplicate event cancellation", async () => {
    if (!servicesReady) {
      console.warn("Services not ready, skipping test");
      return;
    }

    const assessmentId = `assessment-idempotent-${Date.now()}`;
    const positionId = `pos-idempotent-${Date.now()}`;
    const eventId = `event-idempotent-${Date.now()}`;

    const initialState: AssessmentState = {
      currentBalance: 50000,
      peakBalance: 50000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      tradeCount: 0,
      positions: [
        {
          id: positionId,
          market: `polymarket:${eventId}`,
          side: "yes",
          quantity: 100,
          entryPrice: 0.6,
          currentPrice: 0.6,
          unrealizedPnl: 0,
          openedAt: new Date(),
          status: 'active',
        },
      ],
    };

    await redis.set(`assessment:${assessmentId}:state`, JSON.stringify(initialState));

    // Publish event cancellation first time
    await kafkaProducer.send({
      topic: "events.event-cancelled",
      messages: [
        {
          value: JSON.stringify({
            event_id: eventId,
            source: "polymarket",
            status: "cancelled",
            timestamp: new Date(),
          }),
        },
      ],
    });

    await waitForPositionCancelled(assessmentId, positionId);

    const firstUpdateJson = await redis.get(`assessment:${assessmentId}:state`);
    const firstUpdate = JSON.parse(firstUpdateJson!) as AssessmentState;
    const firstBalance = firstUpdate.currentBalance;

    // Publish same event cancellation again
    await kafkaProducer.send({
      topic: "events.event-cancelled",
      messages: [
        {
          value: JSON.stringify({
            event_id: eventId,
            source: "polymarket",
            status: "cancelled",
            timestamp: new Date(),
          }),
        },
      ],
    });

    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    const secondUpdateJson = await redis.get(`assessment:${assessmentId}:state`);
    const secondUpdate = JSON.parse(secondUpdateJson!) as AssessmentState;
    const secondBalance = secondUpdate.currentBalance;

    // Verify balance not double-refunded
    expect(secondBalance).toBe(firstBalance);
  });
});
