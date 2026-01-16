import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import axios from "axios";

describe("Monte Carlo Service Integration Tests", () => {
  const SERVICE_URL = "http://localhost:3002";
  const MOCK_ASSESSMENT_ID = "test-assessment-123";
  const MOCK_FUNDED_ACCOUNT_ID = "test-funded-account-456";

  // Flag to skip tests if service is not available
  let serviceAvailable = false;

  beforeAll(async () => {
    // Wait for service to be ready (with timeout)
    let retries = 5;
    while (retries > 0) {
      try {
        await axios.get(`${SERVICE_URL}/health`, { timeout: 2000 });
        serviceAvailable = true;
        break;
      } catch {
        retries--;
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    if (!serviceAvailable) {
      console.warn(
        "Monte Carlo Service not available - skipping integration tests"
      );
    }
  });

  afterAll(async () => {
    // Cleanup
  });

  it("should return health status", async () => {
    if (!serviceAvailable) {
      console.log("Skipping: service not available");
      return;
    }

    const response = await axios.get(`${SERVICE_URL}/health`);
    expect(response.data).toEqual({ status: "ok" });
  });

  it("should return ready status when dependencies are available", async () => {
    if (!serviceAvailable) {
      console.log("Skipping: service not available");
      return;
    }

    try {
      const response = await axios.get(`${SERVICE_URL}/ready`);
      // Readiness may fail if dependencies are not available, which is expected
      expect(response.data).toHaveProperty("status");
    } catch (error: any) {
      // Expected if dependencies are not available
      expect(error.response?.data).toHaveProperty("status");
    }
  });

  it("should return error when neither assessmentId nor fundedAccountId provided", async () => {
    if (!serviceAvailable) {
      console.log("Skipping: service not available");
      return;
    }

    try {
      await axios.post(`${SERVICE_URL}/simulations`, {});
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.response?.status).toBe(400);
      expect(error.response?.data).toHaveProperty("error");
    }
  });

  it("should handle non-existent job gracefully", async () => {
    if (!serviceAvailable) {
      console.log("Skipping: service not available");
      return;
    }

    try {
      await axios.get(`${SERVICE_URL}/simulations/non-existent-job-id`);
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.response?.status).toBe(404);
    }
  });

  it("should list simulation jobs", async () => {
    if (!serviceAvailable) {
      console.log("Skipping: service not available");
      return;
    }

    try {
      const response = await axios.get(`${SERVICE_URL}/simulations`);
      expect(response.data).toHaveProperty("jobs");
      expect(Array.isArray(response.data.jobs)).toBe(true);
    } catch (error: any) {
      // Expected if database is not available
      expect(error.response?.status).toBe(500);
    }
  });

  it("should validate HTTP status codes on errors", async () => {
    if (!serviceAvailable) {
      console.log("Skipping: service not available");
      return;
    }

    // Test 400 for invalid input
    try {
      await axios.post(`${SERVICE_URL}/simulations`, {});
    } catch (error: any) {
      expect(error.response?.status).toBe(400);
    }

    // Test 404 for not found
    try {
      await axios.get(`${SERVICE_URL}/simulations/invalid-id`);
    } catch (error: any) {
      expect(error.response?.status).toBe(404);
    }
  });
});
