import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { signToken } from '../src/utils/jwt';

const JWT_SECRET = 'test-secret-key';
const WS_URL = 'ws://localhost:3003/ws';

describe('WebSocket Service Integration Tests', () => {
  let ws: WebSocket;

  beforeAll(async () => {
    // Wait for service to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it('should reject connection without token', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}`);

      ws.onopen = () => {
        reject(new Error('Connection should have been rejected'));
      };

      ws.onclose = () => {
        resolve();
      };

      ws.onerror = () => {
        resolve();
      };

      setTimeout(() => {
        ws.close();
        resolve();
      }, 2000);
    });
  });

  it('should reject connection with invalid token', async () => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}?token=invalid-token`);

      ws.onopen = () => {
        reject(new Error('Connection should have been rejected'));
      };

      ws.onclose = () => {
        resolve();
      };

      ws.onerror = () => {
        resolve();
      };

      setTimeout(() => {
        ws.close();
        resolve();
      }, 2000);
    });
  });

  it('should accept connection with valid token', async () => {
    return new Promise<void>((resolve, reject) => {
      const token = signToken({ userId: 'test-user' }, JWT_SECRET);
      const ws = new WebSocket(`${WS_URL}?token=${token}&assessmentId=test-assessment`);

      ws.onopen = () => {
        ws.close();
        resolve();
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);
    });
  });

  it('should receive welcome message on connection', async () => {
    return new Promise<void>((resolve, reject) => {
      const token = signToken({ userId: 'test-user' }, JWT_SECRET);
      const ws = new WebSocket(`${WS_URL}?token=${token}`);

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          expect(message.type).toBe('connected');
          expect(message.userId).toBe('test-user');
          expect(message.connectionId).toBeDefined();
          ws.close();
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => {
        reject(new Error('Message timeout'));
      }, 5000);
    });
  });

  it('should respond to ping with pong', async () => {
    return new Promise<void>((resolve, reject) => {
      const token = signToken({ userId: 'test-user' }, JWT_SECRET);
      const ws = new WebSocket(`${WS_URL}?token=${token}`);
      let receivedWelcome = false;

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'connected') {
            receivedWelcome = true;
            // Send pong response
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          } else if (message.type === 'ping' && receivedWelcome) {
            // Received ping, send pong
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            ws.close();
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => {
        reject(new Error('Heartbeat timeout'));
      }, 10000);
    });
  });

  it('should handle graceful disconnect', async () => {
    return new Promise<void>((resolve, reject) => {
      const token = signToken({ userId: 'test-user' }, JWT_SECRET);
      const ws = new WebSocket(`${WS_URL}?token=${token}`);

      ws.onopen = () => {
        ws.close(1000, 'Normal closure');
      };

      ws.onclose = (event) => {
        expect(event.code).toBe(1000);
        resolve();
      };

      ws.onerror = (error) => {
        reject(error);
      };

      setTimeout(() => {
        reject(new Error('Disconnect timeout'));
      }, 5000);
    });
  });

  it('should handle reconnection', async () => {
    return new Promise<void>((resolve, reject) => {
      const token = signToken({ userId: 'test-user' }, JWT_SECRET);
      let connectionCount = 0;

      const connect = () => {
        const ws = new WebSocket(`${WS_URL}?token=${token}`);

        ws.onopen = () => {
          connectionCount++;
          ws.close();
        };

        ws.onclose = () => {
          if (connectionCount < 2) {
            setTimeout(connect, 100);
          } else {
            resolve();
          }
        };

        ws.onerror = (error) => {
          reject(error);
        };
      };

      connect();

      setTimeout(() => {
        reject(new Error('Reconnection timeout'));
      }, 10000);
    });
  });
});
