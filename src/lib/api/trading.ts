import { apiClient } from '../api-client';
import { Position, Trade, Order } from '../../types';

export interface PlaceOrderRequest {
  assessment_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  size: number;
  price?: number;
}

export async function placeOrder(order: PlaceOrderRequest): Promise<Order> {
  return apiClient.post<Order>('/orders', order);
}

export async function getPositions(assessmentId: string): Promise<Position[]> {
  return apiClient.get<Position[]>(`/positions?assessment_id=${assessmentId}`);
}

export async function getTrades(assessmentId: string): Promise<Trade[]> {
  return apiClient.get<Trade[]>(`/trades?assessment_id=${assessmentId}`);
}

export async function closePosition(positionId: string): Promise<Position> {
  return apiClient.post<Position>(`/positions/${positionId}/close`);
}
