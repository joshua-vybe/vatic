import { apiClient } from '../api-client';
import { Assessment } from '../../types';

export async function getAssessments(): Promise<Assessment[]> {
  return apiClient.get<Assessment[]>('/assessments');
}

export async function getAssessment(id: string): Promise<Assessment> {
  return apiClient.get<Assessment>(`/assessments/${id}`);
}

export async function startAssessment(id: string): Promise<Assessment> {
  return apiClient.post<Assessment>(`/assessments/${id}/start`);
}

export async function pauseAssessment(id: string): Promise<Assessment> {
  return apiClient.post<Assessment>(`/assessments/${id}/pause`);
}

export async function abandonAssessment(id: string): Promise<Assessment> {
  return apiClient.post<Assessment>(`/assessments/${id}/abandon`);
}
