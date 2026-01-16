import { apiClient } from '../api-client';
import { Tier, Purchase } from '../../types';

export async function getTiers(): Promise<Tier[]> {
  return apiClient.get<Tier[]>('/tiers');
}

export interface CreatePurchaseRequest {
  tier_id: string;
}

export async function createPurchase(tierId: string): Promise<Purchase> {
  return apiClient.post<Purchase>('/purchases', {
    tier_id: tierId,
  });
}

export async function getPurchase(purchaseId: string): Promise<Purchase> {
  return apiClient.get<Purchase>(`/purchases/${purchaseId}`);
}
