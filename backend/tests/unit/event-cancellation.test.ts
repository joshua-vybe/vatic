import { describe, it, expect } from "bun:test";
import { calculateCancellationRefund } from "../../core-service/src/utils/trading";

/**
 * Unit Tests for Event Cancellation Refund Calculations
 * 
 * Tests the shared refund calculation logic: (entryPrice × quantity) + fees
 * Verifies cost recovery without profit/loss
 */

interface Position {
  id: string;
  market: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  openedAt: Date;
  status: 'active' | 'cancelled';
}

describe("Event Cancellation Refund Calculations", () => {
  describe("Basic refund calculation for crypto positions", () => {
    it("should calculate refund as cost recovery for single crypto position", () => {
      const fee = 0.001; // 0.1% crypto fee
      const expectedRefund = (50000 * 1) + (50000 * 1 * 0.001);
      const actualRefund = calculateCancellationRefund(50000, 1, fee);

      expect(actualRefund).toBe(expectedRefund);
      expect(actualRefund).toBe(50050); // Exact cost recovery
    });

    it("should calculate refund for crypto position with multiple quantity", () => {
      const fee = 0.001;
      const expectedRefund = (2000 * 10) + (2000 * 10 * 0.001);
      const actualRefund = calculateCancellationRefund(2000, 10, fee);

      expect(actualRefund).toBe(expectedRefund);
      expect(actualRefund).toBe(20020);
    });

    it("should not include profit or loss in refund", () => {
      const fee = 0.001;
      // Refund should be based on entry price, not current price
      const expectedRefund = (50000 * 1) + (50000 * 1 * 0.001);
      const actualRefund = calculateCancellationRefund(50000, 1, fee);

      expect(actualRefund).toBe(expectedRefund);
      expect(actualRefund).toBe(50050);
      // Verify profit is not included
      expect(actualRefund).not.toBe(55000 + (55000 * 0.001));
    });

    it("should calculate refund for losing position without loss", () => {
      const fee = 0.001;
      // Refund should be based on entry price, not current price
      const expectedRefund = (50000 * 1) + (50000 * 1 * 0.001);
      const actualRefund = calculateCancellationRefund(50000, 1, fee);

      expect(actualRefund).toBe(expectedRefund);
      expect(actualRefund).toBe(50050);
      // Verify loss is not deducted
      expect(actualRefund).not.toBe(45000 + (45000 * 0.001));
    });
  });

  describe("Basic refund calculation for prediction market positions", () => {
    it("should calculate refund for prediction market position at 0.4 probability", () => {
      const fee = 0.0005; // 0.05% prediction market fee
      const expectedRefund = (0.4 * 100) + (0.4 * 100 * 0.0005);
      const actualRefund = calculateCancellationRefund(0.4, 100, fee);

      expect(actualRefund).toBeCloseTo(expectedRefund, 5);
      expect(actualRefund).toBeCloseTo(40.02, 5);
    });

    it("should calculate refund for prediction market position at 0.6 probability", () => {
      const fee = 0.0005;
      const expectedRefund = (0.6 * 100) + (0.6 * 100 * 0.0005);
      const actualRefund = calculateCancellationRefund(0.6, 100, fee);

      expect(actualRefund).toBeCloseTo(expectedRefund, 5);
      expect(actualRefund).toBeCloseTo(60.03, 5);
    });

    it("should calculate refund for prediction market position at 0.8 probability", () => {
      const fee = 0.0005;
      const expectedRefund = (0.8 * 100) + (0.8 * 100 * 0.0005);
      const actualRefund = calculateCancellationRefund(0.8, 100, fee);

      expect(actualRefund).toBeCloseTo(expectedRefund, 5);
      expect(actualRefund).toBeCloseTo(80.04, 5);
    });
  });

  describe("Multiple positions on same event", () => {
    it("should calculate total refund for multiple positions with different entry prices", () => {
      const positions = [
        { entryPrice: 0.4, quantity: 100 },
        { entryPrice: 0.6, quantity: 100 },
        { entryPrice: 0.8, quantity: 100 },
      ];

      const fee = 0.0005;
      const totalRefund = positions.reduce(
        (sum, pos) => sum + calculateCancellationRefund(pos.entryPrice, pos.quantity, fee),
        0
      );

      const expectedTotal = 
        ((0.4 * 100) + (0.4 * 100 * 0.0005)) +
        ((0.6 * 100) + (0.6 * 100 * 0.0005)) +
        ((0.8 * 100) + (0.8 * 100 * 0.0005));

      expect(totalRefund).toBeCloseTo(expectedTotal, 5);
      expect(totalRefund).toBeCloseTo(180.09, 5);
    });

    it("should calculate total refund for mixed crypto and prediction positions", () => {
      const cryptoFee = 0.001;
      const predictionFee = 0.0005;

      const cryptoRefund = calculateCancellationRefund(50000, 1, cryptoFee);
      const predictionRefund = calculateCancellationRefund(0.6, 100, predictionFee);
      const totalRefund = cryptoRefund + predictionRefund;

      expect(cryptoRefund).toBe(50050);
      expect(predictionRefund).toBeCloseTo(60.03, 5);
      expect(totalRefund).toBeCloseTo(50110.03, 5);
    });
  });

  describe("Edge cases", () => {
    it("should handle zero quantity position", () => {
      const refund = calculateCancellationRefund(50000, 0, 0.001);
      expect(refund).toBe(0);
    });

    it("should handle large quantity positions with precision", () => {
      const expectedRefund = (50000 * 1000) + (50000 * 1000 * 0.001);
      const refund = calculateCancellationRefund(50000, 1000, 0.001);

      expect(refund).toBe(expectedRefund);
      expect(refund).toBe(50050000);
    });

    it("should handle very small entry prices", () => {
      const expectedRefund = (0.01 * 1000) + (0.01 * 1000 * 0.0005);
      const refund = calculateCancellationRefund(0.01, 1000, 0.0005);

      expect(refund).toBeCloseTo(expectedRefund, 5);
      expect(refund).toBeCloseTo(10.005, 5);
    });

    it("should handle very high entry prices", () => {
      const expectedRefund = (100000 * 1) + (100000 * 1 * 0.001);
      const refund = calculateCancellationRefund(100000, 1, 0.001);

      expect(refund).toBe(expectedRefund);
      expect(refund).toBe(100100);
    });
  });

  describe("Different fee structures", () => {
    it("should calculate refund with crypto fee (0.1%)", () => {
      const cryptoFee = 0.001;
      const refund = calculateCancellationRefund(2000, 10, cryptoFee);

      expect(refund).toBe(20020);
    });

    it("should calculate refund with prediction market fee (0.05%)", () => {
      const predictionFee = 0.0005;
      const refund = calculateCancellationRefund(0.5, 100, predictionFee);

      expect(refund).toBeCloseTo(50.025, 5);
    });

    it("should calculate refund with higher fee structure", () => {
      const higherFee = 0.002; // 0.2%
      const refund = calculateCancellationRefund(50000, 1, higherFee);

      expect(refund).toBe(50100);
    });
  });

  describe("Verify no profit/loss in refund", () => {
    it("should not include unrealized profit in refund", () => {
      const fee = 0.001;
      const refund = calculateCancellationRefund(50000, 1, fee);

      // Refund should be based on entry price only
      expect(refund).toBe(50050);
      // Should not include the 10000 profit
      expect(refund).not.toBeGreaterThan(50050);
    });

    it("should not deduct unrealized loss from refund", () => {
      const fee = 0.001;
      const refund = calculateCancellationRefund(50000, 1, fee);

      // Refund should be based on entry price only
      expect(refund).toBe(50050);
      // Should not be reduced by the 10000 loss
      expect(refund).not.toBeLessThan(50050);
    });

    it("should return exact cost recovery for all positions", () => {
      const positions = [
        { entryPrice: 50000, quantity: 1 },
        { entryPrice: 2000, quantity: 10 },
      ];

      const fee = 0.001;
      const refunds = positions.map(pos => calculateCancellationRefund(pos.entryPrice, pos.quantity, fee));

      // Each refund should be exact cost recovery
      expect(refunds[0]).toBe(50050); // Not 55000+
      expect(refunds[1]).toBe(20020); // Not 18000+
    });
  });
});
