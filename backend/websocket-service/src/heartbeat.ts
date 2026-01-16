import { ConnectionManager, ClientConnection } from './connection-manager';
import { createLogger } from './utils/logger';
import { MetricsCollector } from './utils/metrics';

const logger = createLogger('heartbeat');

let heartbeatInterval: NodeJS.Timeout | null = null;

export function startHeartbeatMonitor(
  connectionManager: ConnectionManager,
  interval: number,
  connectionTimeout: number,
  metricsCollector: MetricsCollector
): void {
  if (heartbeatInterval) {
    logger.warn('Heartbeat monitor already running');
    return;
  }

  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const connections = connectionManager.getAllConnections();
    let activeConnections = 0;
    let staleConnectionsClosed = 0;

    for (const connection of connections) {
      const timeSinceLastHeartbeat = now - connection.lastHeartbeat.getTime();

      if (timeSinceLastHeartbeat > connectionTimeout) {
        // Close stale connection
        try {
          connection.ws.close(1000, 'Heartbeat timeout');
          connectionManager.removeConnection(
            Array.from(connectionManager['connections'].entries()).find(
              ([_, conn]) => conn === connection
            )?.[0] || ''
          );
          metricsCollector.recordHeartbeatFailure();
          staleConnectionsClosed++;
        } catch (error) {
          logger.warn('Failed to close stale connection', { error: String(error) });
        }
      } else {
        // Send ping to active connection
        try {
          connection.ws.send(
            JSON.stringify({
              type: 'ping',
              timestamp: Date.now(),
            })
          );
          activeConnections++;
        } catch (error) {
          logger.warn('Failed to send ping', { error: String(error) });
        }
      }
    }

    logger.debug('Heartbeat monitor cycle', {
      activeConnections,
      staleConnectionsClosed,
      totalConnections: connections.length,
    });
  }, interval);

  logger.info('Heartbeat monitor started', { interval, connectionTimeout });
}

export function stopHeartbeatMonitor(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    logger.info('Heartbeat monitor stopped');
  }
}
