import { apiClient } from '../api-client';
import { FundedAccount, Withdrawal } from '../../types';

export async function getFundedAccounts(): Promise<FundedAccount[]> {
  return apiClient.get<FundedAccount[]>('/funded-accounts');
}

export async function getFundedAccount(id: string): Promise<FundedAccount> {
  return apiClient.get<FundedAccount>(`/funded-accounts/${id}`);
}

export interface WithdrawalRequest {
  amount: number;
}

export async function requestWithdrawal(accountId: string, amount: number): Promise<Withdrawal> {
  return apiClient.post<Withdrawal>(`/funded-accounts/${accountId}/withdraw`, {
    amount,
  });
}

export async function getWithdrawals(accountId: string): Promise<Withdrawal[]> {
  return apiClient.get<Withdrawal[]>(`/funded-accounts/${accountId}/withdrawals`);
}
