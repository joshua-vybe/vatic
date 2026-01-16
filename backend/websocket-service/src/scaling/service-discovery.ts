import Redis from 'ioredis';
import { ConsistentHash } from './consistent-hash';
import { createLogger } from '../utils/logger';

const logger = createLogger('service-discovery');

export class ServiceDiscovery {
  private consistentHash: ConsistentHash;
  private nodeId: string;
  private redis: Redis;
  private pubsub: Redis;

  constructor(nodeId: string, redis: Redis) {
    this.nodeId = nodeId;
    this.redis = redis;
    this.pubsub = redis.duplicate();
    this.consistentHash = new ConsistentHash();
  }

  async initialize(): Promise<void> {
    try {
      // Register this node
      await this.registerNode();

      // Subscribe to node events
      await this.pubsub.subscribe('websocket:node:join', 'websocket:node:leave', (err) => {
        if (err) {
          logger.error('Failed to subscribe to node events', { error: String(err) });
        } else {
          logger.info('Subscribed to node events');
        }
      });

      // Handle incoming messages
      this.pubsub.on('message', async (channel, message) => {
        if (channel === 'websocket:node:join') {
          this.consistentHash.addNode(message);
          logger.info('Node joined', { nodeId: message });
        } else if (channel === 'websocket:node:leave') {
          this.consistentHash.removeNode(message);
          logger.info('Node left', { nodeId: message });
        }
      });

      // Load existing nodes
      const nodes = await this.redis.smembers('websocket:nodes');
      for (const node of nodes) {
        this.consistentHash.addNode(node);
      }

      logger.info('Service discovery initialized', {
        nodeId: this.nodeId,
        totalNodes: this.consistentHash.getNodeCount(),
      });
    } catch (error) {
      logger.error('Failed to initialize service discovery', { error: String(error) });
      throw error;
    }
  }

  async registerNode(): Promise<void> {
    try {
      await this.redis.sadd('websocket:nodes', this.nodeId);
      await this.redis.publish('websocket:node:join', this.nodeId);
      logger.info('Node registered', { nodeId: this.nodeId });
    } catch (error) {
      logger.error('Failed to register node', { error: String(error) });
      throw error;
    }
  }

  async deregisterNode(): Promise<void> {
    try {
      await this.redis.srem('websocket:nodes', this.nodeId);
      await this.redis.publish('websocket:node:leave', this.nodeId);
      logger.info('Node deregistered', { nodeId: this.nodeId });
    } catch (error) {
      logger.error('Failed to deregister node', { error: String(error) });
    }
  }

  getNodeForAssessment(assessmentId: string): string | null {
    return this.consistentHash.getNode(assessmentId);
  }

  getNodes(): string[] {
    return this.consistentHash.getNodes();
  }

  async shutdown(): Promise<void> {
    try {
      await this.deregisterNode();
      await this.pubsub.unsubscribe();
      await this.pubsub.quit();
      logger.info('Service discovery shutdown');
    } catch (error) {
      logger.error('Failed to shutdown service discovery', { error: String(error) });
    }
  }
}
