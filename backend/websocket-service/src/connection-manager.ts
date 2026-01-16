import { Server } from 'bun';
import { createLogger } from './utils/logger';

const logger = createLogger('connection-manager');

export interface ClientConnection {
  ws: WebSocket;
  userId: string;
  assessmentId?: string;
  connectedAt: Date;
  lastHeartbeat: Date;
}

export class ConnectionManager {
  private connections: Map<string, ClientConnection> = new Map();
  private assessmentIndex: Map<string, Set<string>> = new Map();

  addConnection(connectionId: string, connection: ClientConnection): void {
    this.connections.set(connectionId, connection);

    if (connection.assessmentId) {
      if (!this.assessmentIndex.has(connection.assessmentId)) {
        this.assessmentIndex.set(connection.assessmentId, new Set());
      }
      this.assessmentIndex.get(connection.assessmentId)!.add(connectionId);
    }

    logger.debug('Connection added', {
      connectionId,
      userId: connection.userId,
      assessmentId: connection.assessmentId,
      totalConnections: this.connections.size,
    });
  }

  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      this.connections.delete(connectionId);

      if (connection.assessmentId) {
        const assessmentConnections = this.assessmentIndex.get(connection.assessmentId);
        if (assessmentConnections) {
          assessmentConnections.delete(connectionId);
          if (assessmentConnections.size === 0) {
            this.assessmentIndex.delete(connection.assessmentId);
          }
        }
      }

      logger.debug('Connection removed', {
        connectionId,
        userId: connection.userId,
        assessmentId: connection.assessmentId,
        totalConnections: this.connections.size,
      });
    }
  }

  getConnection(connectionId: string): ClientConnection | undefined {
    return this.connections.get(connectionId);
  }

  getConnectionsByAssessmentId(assessmentId: string): ClientConnection[] {
    const connectionIds = this.assessmentIndex.get(assessmentId) || new Set();
    return Array.from(connectionIds)
      .map((id) => this.connections.get(id))
      .filter((conn) => conn !== undefined) as ClientConnection[];
  }

  getAllConnections(): ClientConnection[] {
    return Array.from(this.connections.values());
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getConnectionCountByAssessment(assessmentId: string): number {
    return this.assessmentIndex.get(assessmentId)?.size || 0;
  }

  getMetrics() {
    return {
      totalConnections: this.connections.size,
      assessmentsWithConnections: this.assessmentIndex.size,
      connectionsPerAssessment: Array.from(this.assessmentIndex.entries()).map(([assessmentId, ids]) => ({
        assessmentId,
        count: ids.size,
      })),
    };
  }
}
