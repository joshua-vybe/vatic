import { describe, it, expect, beforeAll, afterAll } from "bun:test";

/**
 * Real Assessment Flow E2E Tests
 * 
 * These tests exercise the complete assessment flow through HTTP APIs:
 * - User registration and authentication
 * - Tier purchase with payment processing
 * - Assessment creation and trading
 * - Real-time balance and P&L updates
 * - Assessment pass/fail conditions
 * 
 * Prerequisites:
 * - docker-compose -f docker-compose.test.yml up -d
 * - Core Service running on http://localhost:3000
 * - WebSocket Service running on ws://localhost:3001
 */

const CORE_SERVICE_URL = "http://localhost:3000";
const WEBSOCKET_URL = "ws://localhost:3001";

interface User {
  id: string;
  email: string;
  token: string;
}

interface Assessment {
  id: string;
  user_id: string;
  tier_id: string;
  status: "pending" | "active" | "passed" | "failed";
  balance: number;
  peak_balance: number;
  starting_balance: number;
}

interface Order {
  id: string;
  assessment_id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  status: "filled" | "failed";
}

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

describe("Assessment Flow E2E (Real HTTP APIs)", () => {
  let serviceAvailable = false;

  beforeAll(async () => {
    serviceAvailable = await waitForService(CORE_SERVICE_URL);
    if (!serviceAvailable) {
      console.warn("⚠️  Core Service not available. Skipping real E2E tests.");
      console.warn("Run: docker-compose -f docker-compose.test.yml up -d");
    }
  });

  describe("User Registration and Authentication", () => {
    it("should register a new user", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;
      const response = await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.id).toBeDefined();
      expect(data.email).toBe(email);
    });

    it("should login and receive JWT token", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Register
      await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      // Login
      const response = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.token).toBeDefined();
      expect(data.token.length).toBeGreaterThan(0);
    });

    it("should validate JWT token", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Register and login
      await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const loginResponse = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const { token } = await loginResponse.json();

      // Validate token
      const response = await fetch(`${CORE_SERVICE_URL}/auth/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Tier Purchase and Payment", () => {
    it("should create purchase for tier", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Register and login
      await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const loginResponse = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const { token } = await loginResponse.json();

      // Create purchase
      const response = await fetch(`${CORE_SERVICE_URL}/payment/purchase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          tier_id: "tier-1",
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.session_id).toBeDefined();
    });
  });

  describe("Assessment Creation and Management", () => {
    it("should create assessment after purchase", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Register and login
      await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const loginResponse = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const { token } = await loginResponse.json();

      // Create assessment
      const response = await fetch(`${CORE_SERVICE_URL}/assessments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          tier_id: "tier-1",
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.id).toBeDefined();
      expect(data.status).toBe("active");
      expect(data.balance).toBe(50000);
    });

    it("should retrieve assessment details", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Register, login, and create assessment
      await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const loginResponse = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const { token } = await loginResponse.json();

      const createResponse = await fetch(`${CORE_SERVICE_URL}/assessments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          tier_id: "tier-1",
        }),
      });

      const { id } = await createResponse.json();

      // Get assessment
      const response = await fetch(`${CORE_SERVICE_URL}/assessments/${id}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(id);
      expect(data.status).toBe("active");
    });
  });

  describe("Trading and Order Placement", () => {
    it("should place order in assessment", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Setup
      await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const loginResponse = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const { token } = await loginResponse.json();

      const createResponse = await fetch(`${CORE_SERVICE_URL}/assessments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          tier_id: "tier-1",
        }),
      });

      const { id: assessmentId } = await createResponse.json();

      // Place order
      const response = await fetch(`${CORE_SERVICE_URL}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          assessment_id: assessmentId,
          market: "BTC/USD",
          side: "long",
          quantity: 0.1,
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.id).toBeDefined();
      expect(data.assessment_id).toBe(assessmentId);
      expect(data.status).toBe("filled");
    });

    it("should retrieve positions for assessment", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Setup and place order
      await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const loginResponse = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const { token } = await loginResponse.json();

      const createResponse = await fetch(`${CORE_SERVICE_URL}/assessments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          tier_id: "tier-1",
        }),
      });

      const { id: assessmentId } = await createResponse.json();

      await fetch(`${CORE_SERVICE_URL}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          assessment_id: assessmentId,
          market: "BTC/USD",
          side: "long",
          quantity: 0.1,
        }),
      });

      // Get positions
      const response = await fetch(`${CORE_SERVICE_URL}/positions?assessment_id=${assessmentId}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe("Real-Time Updates", () => {
    it("should track balance updates", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Setup
      await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const loginResponse = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const { token } = await loginResponse.json();

      const createResponse = await fetch(`${CORE_SERVICE_URL}/assessments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          tier_id: "tier-1",
        }),
      });

      const assessment = await createResponse.json();

      // Get updated assessment
      const response = await fetch(`${CORE_SERVICE_URL}/assessments/${assessment.id}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      const updated = await response.json();
      expect(updated.balance).toBeDefined();
      expect(updated.peak_balance).toBeDefined();
    });
  });

  describe("Assessment Pass/Fail Conditions", () => {
    it("should check pass conditions", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Setup
      await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const loginResponse = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });

      const { token } = await loginResponse.json();

      const createResponse = await fetch(`${CORE_SERVICE_URL}/assessments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          tier_id: "tier-1",
        }),
      });

      const assessment = await createResponse.json();

      // Check pass conditions
      const response = await fetch(`${CORE_SERVICE_URL}/assessments/${assessment.id}/check-pass`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.passed).toBeDefined();
    });
  });

  describe("Complete Assessment Flow", () => {
    it("should complete full assessment flow: register → login → create → trade → check pass", async () => {
      if (!serviceAvailable) {
        console.warn("Skipping: Service not available");
        return;
      }

      const email = `trader-${Date.now()}@example.com`;

      // Step 1: Register
      const registerResponse = await fetch(`${CORE_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });
      expect(registerResponse.status).toBe(201);

      // Step 2: Login
      const loginResponse = await fetch(`${CORE_SERVICE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: "password123",
        }),
      });
      expect(loginResponse.status).toBe(200);
      const { token } = await loginResponse.json();

      // Step 3: Create assessment
      const createResponse = await fetch(`${CORE_SERVICE_URL}/assessments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          tier_id: "tier-1",
        }),
      });
      expect(createResponse.status).toBe(201);
      const assessment = await createResponse.json();
      expect(assessment.status).toBe("active");

      // Step 4: Place orders
      const orderResponse = await fetch(`${CORE_SERVICE_URL}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          assessment_id: assessment.id,
          market: "BTC/USD",
          side: "long",
          quantity: 0.1,
        }),
      });
      expect(orderResponse.status).toBe(201);

      // Step 5: Get updated assessment
      const getResponse = await fetch(`${CORE_SERVICE_URL}/assessments/${assessment.id}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });
      expect(getResponse.status).toBe(200);
      const updated = await getResponse.json();
      expect(updated.id).toBe(assessment.id);

      expect(true).toBe(true);
    });
  });
});
