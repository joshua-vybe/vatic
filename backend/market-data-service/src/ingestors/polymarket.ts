import WebSocket from 'ws';
import axios from 'axios';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { publishEvent, TOPIC_POLYMARKET_TICKS, TOPIC_EVENT_CANCELLED } from '../utils/kafka';
import { cacheMarketPrice } from '../utils/redis';
import { createLogger } from '../utils/logger';
import { updateEventStatus } from '../utils/event-monitor';
import { incrementPublishCount, incrementPublishErrors, updatePublishLatency, setIngestorRunning, setCircuitBreakerState } from '../utils/metrics';

const logger = createLogger('polymarket-ingestor');

// Gamma GraphQL WebSocket endpoints
const GAMMA_GRAPHQL_WS_URL = 'wss://gamma-api.polymarket.com/graphql';
const GAMMA_GRAPHQL_BACKUP_WS_URL = 'wss://gamma-api-backup.polymarket.com/graphql';

// GraphQL subscription query for market updates
const MARKET_SUBSCRIPTION_QUERY = `
  subscription OnMarketUpdate {
    marketUpdated {
      market_id
      yes_price
      no_price
      timestamp
      status
    }
  }
`;

// REST endpoint for periodic event status check
const POLYMARKET_REST_API_URL = 'https://gamma-api.polymarket.com/markets';

export class PolymarketIngestor {
  private ws: WebSocket | null = null;
  private circuitBreaker: CircuitBreaker;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000;
  private currentWsUrl: string;
  private endpoints: string[] = [GAMMA_GRAPHQL_WS_URL, GAMMA_GRAPHQL_BACKUP_WS_URL];
  private currentEndpointIndex: number = 0;
  private subscriptionId: string | null = null;
  private connectionAckReceived: boolean = false;
  private connectionAckTimeout: NodeJS.Timeout | null = null;
  private eventStatusPollInterval: NodeJS.Timeout | null = null;

  constructor(wsUrl: string = GAMMA_GRAPHQL_WS_URL) {
    this.circuitBreaker = new CircuitBreaker('polymarket', 3, 60000);
    this.currentWsUrl = wsUrl;
    this.endpoints = [wsUrl, GAMMA_GRAPHQL_BACKUP_WS_URL];
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Polymarket ingestor already running');
      return;
    }

    this.isRunning = true;
    setIngestorRunning('polymarket', true);
    logger.info('Starting Polymarket ingestor');

    await this.connect();

    // Start periodic event status polling (every 10 seconds)
    this.eventStatusPollInterval = setInterval(async () => {
      await this.pollEventStatus();
    }, 10000);
  }

  private async connect(): Promise<void> {
    try {
      await this.circuitBreaker.execute(async () => {
        return new Promise<void>((resolve, reject) => {
          let timeoutHandle: NodeJS.Timeout | null = null;
          let resolved = false;

          this.ws = new WebSocket(this.currentWsUrl, 'graphql-ws');

          this.ws.onopen = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (resolved) return;
            resolved = true;

            logger.info('Polymarket GraphQL WebSocket connected', { url: this.currentWsUrl });
            this.reconnectAttempts = 0;
            setCircuitBreakerState('polymarket', this.circuitBreaker.getState());

            // Send GraphQL WS connection_init
            this.sendConnectionInit();

            // Resolve after connection_init is sent
            resolve();
          };

          this.ws.onmessage = (event: any) => {
            this.handleMessage(event.data);
          };

          this.ws.onerror = (error: any) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (resolved) return;
            resolved = true;

            logger.error('Polymarket GraphQL WebSocket error', { error: String(error) });
            setCircuitBreakerState('polymarket', this.circuitBreaker.getState());
            reject(error);
          };

          this.ws.onclose = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            logger.warn('Polymarket GraphQL WebSocket closed');
            this.handleDisconnection();
          };

          timeoutHandle = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            reject(new Error('WebSocket connection timeout'));
          }, 10000);
        });
      });
    } catch (error) {
      logger.error('Failed to connect to Polymarket', { error: String(error) });
      setCircuitBreakerState('polymarket', this.circuitBreaker.getState());
      this.rotateEndpoint();
      this.handleDisconnection();
    }
  }

  private sendConnectionInit(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.connectionAckReceived = false;

    const connectionInitMessage = {
      type: 'connection_init',
      payload: {},
    };

    this.ws.send(JSON.stringify(connectionInitMessage));
    logger.debug('Sent GraphQL connection_init');

    // Set timeout for connection_ack
    this.connectionAckTimeout = setTimeout(() => {
      logger.error('Connection ack timeout, reconnecting');
      if (this.ws) {
        this.ws.close();
      }
    }, 5000);
  }

  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!this.connectionAckReceived) {
      logger.warn('Connection ack not received yet, deferring subscription');
      return;
    }

    this.subscriptionId = `sub_${Date.now()}`;

    const subscriptionMessage = {
      id: this.subscriptionId,
      type: 'start',
      payload: {
        query: MARKET_SUBSCRIPTION_QUERY,
      },
    };

    this.ws.send(JSON.stringify(subscriptionMessage));
    logger.debug('Sent GraphQL subscription', { subscriptionId: this.subscriptionId });
  }

  private rotateEndpoint(): void {
    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.endpoints.length;
    this.currentWsUrl = this.endpoints[this.currentEndpointIndex];
    logger.info('Rotated to next Polymarket endpoint', {
      endpoint: this.currentWsUrl,
      index: this.currentEndpointIndex,
    });
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle GraphQL WS protocol messages
      if (message.type === 'connection_ack') {
        logger.debug('Received GraphQL connection_ack');
        if (this.connectionAckTimeout) {
          clearTimeout(this.connectionAckTimeout);
          this.connectionAckTimeout = null;
        }
        this.connectionAckReceived = true;
        // Now send subscription after ack is received
        this.sendSubscription();
        return;
      }

      if (message.type === 'data') {
        const payload = message.payload?.data?.marketUpdated;
        if (payload) {
          const { market_id, yes_price, no_price, timestamp, status } = payload;

          // Handle event status if present in payload
          if (status && (status === 'cancelled' || status === 'disputed')) {
            updateEventStatus(market_id, 'polymarket', status).catch((error) => {
              logger.error('Failed to update event status', { error: String(error) });
            });
          }

          const normalizedMessage = {
            market: `polymarket:${market_id}`,
            yes_price,
            no_price,
            timestamp: timestamp || Date.now(),
          };

          publishEvent(TOPIC_POLYMARKET_TICKS, normalizedMessage)
            .then((result) => {
              if (result.success) {
                incrementPublishCount();
                updatePublishLatency(result.latency);
              } else {
                incrementPublishErrors();
              }
            })
            .catch((error) => {
              logger.error('Failed to publish Polymarket tick', { error: String(error) });
              incrementPublishErrors();
            });

          cacheMarketPrice(`polymarket:${market_id}`, { yes: yes_price, no: no_price }, 1).catch(
            (error) => {
              logger.error('Failed to cache Polymarket price', { error: String(error) });
            }
          );
        }
        return;
      }

      if (message.type === 'error') {
        logger.error('GraphQL subscription error', { errors: message.payload?.errors });
        return;
      }

      if (message.type === 'complete') {
        logger.warn('GraphQL subscription completed');
        return;
      }
    } catch (error) {
      logger.error('Failed to parse Polymarket message', { error: String(error) });
    }
  }

  private handleDisconnection(): void {
    if (!this.isRunning) {
      return;
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      logger.info('Attempting to reconnect to Polymarket', {
        attempt: this.reconnectAttempts,
        delay,
      });

      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      logger.warn('Max reconnection attempts exceeded for Polymarket, scheduling periodic retries', {
        retryInterval: 30000,
      });

      setTimeout(() => {
        logger.info('Retrying Polymarket connection after extended backoff');
        this.reconnectAttempts = 0;
        this.connect();
      }, 30000);
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    setIngestorRunning('polymarket', false);

    if (this.eventStatusPollInterval) {
      clearInterval(this.eventStatusPollInterval);
      this.eventStatusPollInterval = null;
    }

    if (this.connectionAckTimeout) {
      clearTimeout(this.connectionAckTimeout);
      this.connectionAckTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    logger.info('Polymarket ingestor stopped');
  }

  getState(): string {
    return this.isRunning ? 'running' : 'stopped';
  }

  getCircuitBreakerState(): string {
    return this.circuitBreaker.getState();
  }

  private async pollEventStatus(): Promise<void> {
    try {
      const response = await axios.get(POLYMARKET_REST_API_URL);
      const markets = response.data.markets || [];

      for (const market of markets) {
        const { id, status } = market;

        if (status && (status === 'cancelled' || status === 'disputed')) {
          await updateEventStatus(id, 'polymarket', status);
        }
      }

      logger.debug('Polymarket event status poll completed', { marketCount: markets.length });
    } catch (error) {
      logger.error('Failed to poll Polymarket event status', { error: String(error) });
    }
  }
}
