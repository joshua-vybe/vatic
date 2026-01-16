export const env = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  WS_URL: import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws',
  REPORT_SERVICE_URL: import.meta.env.VITE_REPORT_SERVICE_URL || 'http://localhost:3005',
};

// Validate required environment variables
export function validateEnv() {
  const required = ['API_BASE_URL', 'WS_URL', 'REPORT_SERVICE_URL'];
  const missing = required.filter(key => !env[key as keyof typeof env]);
  
  if (missing.length > 0) {
    console.warn(`Missing environment variables: ${missing.join(', ')}`);
  }
}
