import { toast } from 'sonner';

export interface ApiError {
  status?: number;
  message: string;
  details?: unknown;
}

export function handleApiError(error: unknown): ApiError {
  if (error instanceof Error) {
    const message = error.message;
    
    // Log for debugging
    console.error('API Error:', message);
    
    // Show user-friendly toast
    toast.error(message);
    
    return {
      message,
    };
  }

  const message = 'An unexpected error occurred';
  console.error('Unknown error:', error);
  toast.error(message);
  
  return {
    message,
    details: error,
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  return 'An unexpected error occurred';
}
