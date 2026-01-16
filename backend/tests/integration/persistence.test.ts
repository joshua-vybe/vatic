import { describe, it, expect, beforeEach, afterEach } from "bun:test";

interface AssessmentData {
  id: string;
  balance: number;
  peak_balance: number;
  trade_count: number;
  positions: Array<{ id: string; symbol: string; pnl: number }>;
  updated_at: number;
}

class MockRedisClient {
  private data: Map<string, AssessmentData> = new Map();

  async set(key: string, value: AssessmentData): Promise<void> {
    this.data.set(key, { ...value, updated_at: Date.now() });
  }

  async get(key: string): Promise<AssessmentData | null> {
    return this.data.get(key) || null;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  clear(): void {
    this.data.clear();
  }

  getAll(): Map<string, AssessmentData> {
    return new Map(this.data);
  }
}

class MockDatabaseClient {
  private data: Map<string, AssessmentData> = new Map();
  private syncLog: Array<{ key: string; timestamp: number }> = [];

  async save(key: string, value: AssessmentData): Promise<void> {
    this.data.set(key, value);
    this.syncLog.push({ key, timestamp: Date.now() });
  }

  async load(key: string): Promise<AssessmentData | null> {
    return this.data.get(key) || null;
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  getSyncLog(): Array<{ key: string; timestamp: number }> {
    return this.syncLog;
  }

  clear(): void {
    this.data.clear();
    this.syncLog = [];
  }

  getAll(): Map<string, AssessmentData> {
    return new Map(this.data);
  }
}

class PersistenceWorker {
  private redis: MockRedisClient;
  private database: MockDatabaseClient;
  private syncInterval: number = 5000; // 5 seconds

  constructor(redis: MockRedisClient, database: MockDatabaseClient) {
    this.redis = redis;
    this.database = database;
  }

  async syncRedisToDatabase(): Promise<void> {
    const allData = this.redis.getAll();
    for (const [key, value] of allData) {
      await this.database.save(key, value);
    }
  }

  async loadFromDatabase(key: string): Promise<AssessmentData | null> {
    return this.database.load(key);
  }

  async verifyConsistency(key: string): Promise<boolean> {
    const redisData = await this.redis.get(key);
    const dbData = await this.database.load(key);

    if (!redisData && !dbData) return true;
    if (!redisData || !dbData) return false;

    return (
      redisData.balance === dbData.balance &&
      redisData.peak_balance === dbData.peak_balance &&
      redisData.trade_count === dbData.trade_count
    );
  }
}

describe("Redis → CockroachDB Persistence", () => {
  let redis: MockRedisClient;
  let database: MockDatabaseClient;
  let worker: PersistenceWorker;

  beforeEach(() => {
    redis = new MockRedisClient();
    database = new MockDatabaseClient();
    worker = new PersistenceWorker(redis, database);
  });

  afterEach(() => {
    redis.clear();
    database.clear();
  });

  describe("Data Persistence", () => {
    it("should persist assessment state from Redis to database", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", assessmentData);
      await worker.syncRedisToDatabase();

      const dbData = await database.load("assessment:assessment-1");
      expect(dbData).not.toBeNull();
      expect(dbData?.balance).toBe(50000);
      expect(dbData?.peak_balance).toBe(50000);
    });

    it("should persist position updates", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 49000,
        peak_balance: 50000,
        trade_count: 1,
        positions: [
          {
            id: "pos-1",
            symbol: "BTC/USD",
            pnl: -1000,
          },
        ],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", assessmentData);
      await worker.syncRedisToDatabase();

      const dbData = await database.load("assessment:assessment-1");
      expect(dbData?.positions.length).toBe(1);
      expect(dbData?.positions[0].symbol).toBe("BTC/USD");
      expect(dbData?.positions[0].pnl).toBe(-1000);
    });

    it("should persist balance changes", async () => {
      const initialData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", initialData);
      await worker.syncRedisToDatabase();

      // Update balance
      const updatedData: AssessmentData = {
        ...initialData,
        balance: 51000,
        peak_balance: 51000,
      };

      await redis.set("assessment:assessment-1", updatedData);
      await worker.syncRedisToDatabase();

      const dbData = await database.load("assessment:assessment-1");
      expect(dbData?.balance).toBe(51000);
      expect(dbData?.peak_balance).toBe(51000);
    });

    it("should persist trade count tracking", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 5,
        positions: [],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", assessmentData);
      await worker.syncRedisToDatabase();

      const dbData = await database.load("assessment:assessment-1");
      expect(dbData?.trade_count).toBe(5);
    });
  });

  describe("Data Consistency", () => {
    it("should verify consistency between Redis and database", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", assessmentData);
      await worker.syncRedisToDatabase();

      const isConsistent = await worker.verifyConsistency("assessment:assessment-1");
      expect(isConsistent).toBe(true);
    });

    it("should detect inconsistency when data differs", async () => {
      const redisData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      const dbData: AssessmentData = {
        id: "assessment-1",
        balance: 49000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", redisData);
      await database.save("assessment:assessment-1", dbData);

      const isConsistent = await worker.verifyConsistency("assessment:assessment-1");
      expect(isConsistent).toBe(false);
    });

    it("should handle missing data in database", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", assessmentData);
      // Don't sync to database

      const isConsistent = await worker.verifyConsistency("assessment:assessment-1");
      expect(isConsistent).toBe(false);
    });

    it("should handle missing data in Redis", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await database.save("assessment:assessment-1", assessmentData);
      // Don't set in Redis

      const isConsistent = await worker.verifyConsistency("assessment:assessment-1");
      expect(isConsistent).toBe(false);
    });
  });

  describe("Failure Scenarios", () => {
    it("should handle database unavailable", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", assessmentData);

      // Simulate database failure by not syncing
      const redisData = await redis.get("assessment:assessment-1");
      expect(redisData).not.toBeNull();

      // Data should still be in Redis
      expect(redisData?.balance).toBe(50000);
    });

    it("should handle Redis connection lost", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await database.save("assessment:assessment-1", assessmentData);

      // Simulate Redis connection loss
      redis.clear();

      // Data should still be in database
      const dbData = await database.load("assessment:assessment-1");
      expect(dbData).not.toBeNull();
      expect(dbData?.balance).toBe(50000);
    });
  });

  describe("Sync Tracking", () => {
    it("should track sync operations", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", assessmentData);
      await worker.syncRedisToDatabase();

      const syncLog = database.getSyncLog();
      expect(syncLog.length).toBeGreaterThan(0);
      expect(syncLog[0].key).toBe("assessment:assessment-1");
    });

    it("should track multiple syncs", async () => {
      const assessmentData: AssessmentData = {
        id: "assessment-1",
        balance: 50000,
        peak_balance: 50000,
        trade_count: 0,
        positions: [],
        updated_at: Date.now(),
      };

      await redis.set("assessment:assessment-1", assessmentData);
      await worker.syncRedisToDatabase();

      const updatedData = { ...assessmentData, balance: 51000 };
      await redis.set("assessment:assessment-1", updatedData);
      await worker.syncRedisToDatabase();

      const syncLog = database.getSyncLog();
      expect(syncLog.length).toBe(2);
    });
  });
});
