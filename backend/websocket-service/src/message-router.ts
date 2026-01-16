import { ConnectionManager } from './connection-manager';
import { createLogger } from './utils/logger';
import { MetricsCollector } from './utils/metrics';

const logger = createLogger('message-router');

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export class MessageRouter {
  constructor(
    private connectionManager: ConnectionManager,
    private metricsCollector: MetricsCollector
  ) {}

  async routeKafkaMessage(topic: string, message: any): Promise<void> {
    try {
      let wsMessage: WebSocketMessage | null = null;
      let assessmentId: string | null = null;
      let broadcastToAll = false;

      // Parse message based on topic
      if (topic.startsWith('market-data.')) {
        // Market data - broadcast to all clients
        const market = topic.replace('market-data.', '').replace('-ticks', '');
        wsMessage = {
          type: 'market_price',
          market,
          price: message.price,
          timestamp: message.timestamp,
        };
        broadcastToAll = true;
      } else if (topic === 'trading.order-filled') {
        assessmentId = message.assessmentId;
        wsMessage = {
          type: 'pnl_update',
          assessmentId,
          unrealizedPnl: message.unrealizedPnl,
          realizedPnl: message.realizedPnl,
          currentBalance: message.currentBalance,
          timestamp: message.timestamp,
        };
      } else if (topic === 'trading.position-opened') {
        assessmentId = message.assessmentId;
        wsMessage = {
          type: 'position_update',
          assessmentId,
          positionId: message.positionId,
          market: message.market,
          side: message.side,
          quantity: message.quantity,
          entryPrice: message.entryPrice,
          unrealizedPnl: 0,
          timestamp: message.timestamp,
        };
      } else if (topic === 'trading.position-closed') {
        assessmentId = message.assessmentId;
        wsMessage = {
          type: 'position_update',
          assessmentId,
          positionId: message.positionId,
          market: message.market,
          side: message.side,
          quantity: message.quantity,
          entryPrice: message.entryPrice,
          exitPrice: message.exitPrice,
          realizedPnl: message.realizedPnl,
          timestamp: message.timestamp,
        };
      } else if (topic === 'assessment.balance-updated') {
        assessmentId = message.assessmentId;
        wsMessage = {
          type: 'pnl_update',
          assessmentId,
          currentBalance: message.currentBalance,
          timestamp: message.timestamp,
        };
      } else if (topic === 'assessment.pnl-updated') {
        assessmentId = message.assessmentId;
        wsMessage = {
          type: 'pnl_update',
          assessmentId,
          unrealizedPnl: message.unrealizedPnl,
          realizedPnl: message.realizedPnl,
          timestamp: message.timestamp,
        };
      } else if (topic === 'assessment.created' || topic === 'assessment.started' || topic === 'assessment.completed') {
        assessmentId = message.assessmentId;
        wsMessage = {
          type: 'assessment_update',
          assessmentId,
          status: message.status,
          timestamp: message.timestamp,
        };
      } else if (topic === 'rules.violation-detected') {
        assessmentId = message.assessmentId;
        wsMessage = {
          type: 'violation',
          assessmentId,
          rule: message.ruleType,
          value: message.value,
          threshold: message.threshold,
          timestamp: message.timestamp,
        };
      } else if (topic === 'rules.drawdown-checked') {
        assessmentId = message.assessmentId;
        wsMessage = {
          type: 'rule_status',
          assessmentId,
          rule: 'drawdown',
          value: message.value,
          threshold: message.threshold,
          status: message.status,
          timestamp: message.timestamp,
        };
      }

      if (!wsMessage) {
        logger.warn('Unknown message topic', { topic });
        return;
      }

      // Route message to appropriate clients
      if (broadcastToAll) {
        await this.broadcastToAll(wsMessage);
      } else if (assessmentId) {
        await this.broadcastToAssessment(assessmentId, wsMessage);
      }
    } catch (error) {
      logger.error('Failed to route Kafka message', {
        topic,
        error: String(error),
      });
    }
  }

  async broadcastToAssessment(assessmentId: string, message: WebSocketMessage): Promise<void> {
    const connections = this.connectionManager.getConnectionsByAssessmentId(assessmentId);
    const messageStr = JSON.stringify(message);
    let successCount = 0;
    let failureCount = 0;

    for (const connection of connections) {
      try {
        connection.ws.send(messageStr);
        this.metricsCollector.recordMessageSent();
        successCount++;
      } catch (error) {
        logger.warn('Failed to send message to client', {
          assessmentId,
          error: String(error),
        });
        failureCount++;
      }
    }

    if (connections.length > 0) {
      logger.debug('Broadcast to assessment completed', {
        assessmentId,
        totalConnections: connections.length,
        successCount,
        failureCount,
      });
    }
  }

  async broadcastToAll(message: WebSocketMessage): Promise<void> {
    const connections = this.connectionManager.getAllConnections();
    const messageStr = JSON.stringify(message);
    let successCount = 0;
    let failureCount = 0;

    for (const connection of connections) {
      try {
        connection.ws.send(messageStr);
        this.metricsCollector.recordMessageSent();
        successCount++;
      } catch (error) {
        logger.warn('Failed to send message to client', {
          error: String(error),
        });
        failureCount++;
      }
    }

    logger.debug('Broadcast to all completed', {
      totalConnections: connections.length,
      successCount,
      failureCount,
    });
  }
}
