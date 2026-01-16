import WebSocket from 'ws';
import axios from 'axios';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { publishEvent, TOPIC_KALSHI_TICKS, TOPIC_EVENT_CANCELLED } from '../utils/kafka';
import { cacheMarketPrice } from '../utils/redis';
import { createLogger } from '../utils/logger';
import { updateEventStatus } from '../utils/event-monitor';
import { incrementPublishCount, incrementPublishErrors, updatePublishLatency, setIngestorRunning, setCircuitBreakerState } from '../utils/metrics';

const logger = createLogger('kalshi-ingestor');

const KALSHI_WS_URL = 'wss://api.elections.kalshi.com';
const KALSHI_BACKUP_WS_URL = 'wss://api-backup.elections.kalshi.com';
const KALSHI_REST_API_URL = 'https://api.elections.kalshi.com/v2/markets';
const KALSHI_BACKUP_REST_API_URL = 'https://api-backup.elections.kalshi.com/v2/markets';

export class KalshiIngestor {
  private ws: WebSocket | null = null;
  private circuitBreaker: CircuitBreaker;
  private isRunning: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentWsUrl: string;
  private apiKey?: string;
  private restPollInterval: NodeJS.Timeout | null = null;
  private wsEndpoints: string[] = [KALSHI_WS_URL, KALSHI_BACKUP_WS_URL];
  private restEndpoints: string[] = [KALSHI_REST_API_URL, KALSHI_BACKUP_REST_API_URL];
  private currentWsEndpointIndex: number = 0;
  private currentRestEndpointIndex: number = 0;
  private currentRestUrl: string;

  constructor(wsUrl: string = KALSHI_WS_URL, apiKey?: string) {
    this.circuitBreaker = new CircuitBreaker('kalshi', 3, 60000);
    this.currentWsUrl = wsUrl;
    this.apiKey = apiKey;
    this.wsEndpoints = [wsUrl, KALSHI_BACKUP_WS_URL];
    this.currentRestUrl = this.restEndpoints[0];
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Kalshi ingestor already running');
      return;
    }

    this.isRunning = true;
    setIngestorRunning('kalshi', true);
    logger.info('Starting Kalshi ingestor');

    // Start WebSocket connection
    await this.connect();
  }

  private async connect(): Promise<void> {
    try {
      await this.circuitBreaker.execute(async () => {
        return new Promise<void>((resolve, reject) => {
          let timeoutHandle: NodeJS.Timeout | null = null;
          let resolved = false;

          this.ws = new WebSocket(this.currentWsUrl);

          this.ws.onopen = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (resolved) return;
            resolved = true;

            logger.info('Kalshi WebSocket connected', { url: this.currentWsUrl });
            this.reconnectAttempts = 0;
            setCircuitBreakerState('kalshi', this.circuitBreaker.getState());

            // Stop REST polling since WebSocket is now active
            this.stopRestPolling();

            // Send subscribe command with API key if available
            const subscribeCmd: any = {
              cmd: 'subscribe',
              params: {
                channels: ['orderbook_delta', 'trades'],
              },
            };

            if (this.apiKey) {
              subscribeCmd.auth = { token: this.apiKey };
            }

            this.ws!.send(JSON.stringify(subscribeCmd));

            // Start heartbeat
            this.startHeartbeat();

            resolve();
          };

          this.ws.onmessage = (event) => {
            void this.handleMessage(event.data);
          };

          this.ws.onerror = (error) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (resolved) return;
            resolved = true;

            logger.error('Kalshi WebSocket error', { error: String(error) });
            setCircuitBreakerState('kalshi', this.circuitBreaker.getState());
            reject(error);
          };

          this.ws.onclose = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            logger.warn('Kalshi WebSocket closed');
            this.stopHeartbeat();
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
      logger.error('Failed to connect to Kalshi', { error: String(error) });
      setCircuitBreakerState('kalshi', this.circuitBreaker.getState());
      // Attempt failover to next endpoint
      this.rotateEndpoint();
      this.handleDisconnection();
    }
  }

  private rotateEndpoint(): void {
    this.currentWsEndpointIndex = (this.currentWsEndpointIndex + 1) % this.wsEndpoints.length;
    this.currentWsUrl = this.wsEndpoints[this.currentWsEndpointIndex];
    logger.info('Rotated to next Kalshi WS endpoint', {
      endpoint: this.currentWsUrl,
      index: this.currentWsEndpointIndex,
    });
  }

  private rotateRestEndpoint(): void {
    this.currentRestEndpointIndex = (this.currentRestEndpointIndex + 1) % this.restEndpoints.length;
    this.currentRestUrl = this.restEndpoints[this.currentRestEndpointIndex];
    logger.info('Rotated to next Kalshi REST endpoint', {
      endpoint: this.currentRestUrl,
      index: this.currentRestEndpointIndex,
    });
  }

  private startRestPolling(): void {
    if (this.restPollInterval) {
      logger.debug('REST polling already running');
      return;
    }

    logger.info('Starting Kalshi REST API polling as fallback');
    this.restPollInterval = setInterval(async () => {
      await this.fetchAndPublishViaRest();
    }, 5000);
  }

  private stopRestPolling(): void {
    if (this.restPollInterval) {
      logger.info('Stopping Kalshi REST API polling');
      clearInterval(this.restPollInterval);
      this.restPollInterval = null;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 10000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      if (message.type === 'orderbook_snapshot' || message.type === 'orderbook_delta') {
        const { market_id, yes_ask, no_ask, timestamp } = message;

        const normalizedMessage = {
          market: `kalshi:${market_id}`,
          yes_price: yes_ask,
          no_price: no_ask,
          timestamp: timestamp || Date.now(),
        };

        const result = await publishEvent(TOPIC_KALSHI_TICKS, normalizedMessage);
        if (result.success) {
          incrementPublishCount();
          updatePublishLatency(result.latency);
        } else {
          incrementPublishErrors();
        }

        cacheMarketPrice(`kalshi:${market_id}`, { yes: yes_ask, no: no_ask }, 1).catch((error) => {
          logger.error('Failed to cache Kalshi price', { error: String(error) });
        });
      } else if (message.type === 'event_status') {
        const { event_id, status } = message;

        if (status === 'cancelled' || status === 'disputed') {
          // Rely on updateEventStatus to publish the Kafka event
          updateEventStatus(event_id, 'kalshi', status).catch((error) => {
            logger.error('Failed to update event status', { error: String(error) });
          });
        }
      }
    } catch (error) {
      logger.error('Failed to parse Kalshi message', { error: String(error) });
    }
  }

  private handleDisconnection(): void {
    if (!this.isRunning) {
      return;
    }

    // Start REST polling as fallback when WebSocket is down
    this.startRestPolling();

    this.reconnectAttempts++;

    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      logger.info('Attempting to reconnect to Kalshi', {
        attempt: this.reconnectAttempts,
        delay,
      });

      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      // Max retries exceeded, schedule periodic retry with fixed backoff
      logger.warn('Max reconnection attempts exceeded for Kalshi, scheduling periodic retries', {
        retryInterval: 30000,
      });

      setTimeout(() => {
        logger.info('Retrying Kalshi connection after extended backoff');
        this.reconnectAttempts = 0; // Reset counter for next retry cycle
        this.connect();
      }, 30000); // Retry every 30 seconds
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    setIngestorRunning('kalshi', false);
    this.stopHeartbeat();
    this.stopRestPolling();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    logger.info('Kalshi ingestor stopped');
  }

  getState(): string {
    return this.isRunning ? 'running' : 'stopped';
  }

  getCircuitBreakerState(): string {
    return this.circuitBreaker.getState();
  }

  private async fetchAndPublishViaRest(): Promise<void> {
    try {
      await this.circuitBreaker.execute(async () => {
        const headers: any = {};
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await axios.get(this.currentRestUrl, { headers });
        const markets = response.data.markets || [];

        let publishedCount = 0;

        for (const market of markets) {
          const { id, yes_ask, no_ask, status } = market;

          if (status === 'cancelled' || status === 'disputed') {
            updateEventStatus(id, 'kalshi', status).catch((error) => {
              logger.error('Failed to update event status', { error: String(error) });
            });
          }

          const normalizedMessage = {
            market: `kalshi:${id}`,
            yes_price: yes_ask,
            no_price: no_ask,
            timestamp: Date.now(),
          };

          const result = await publishEvent(TOPIC_KALSHI_TICKS, normalizedMessage);
          if (result.success) {
            incrementPublishCount();
            updatePublishLatency(result.latency);
          } else {
            incrementPublishErrors();
          }

          await cacheMarketPrice(`kalshi:${id}`, { yes: yes_ask, no: no_ask }, 1);
          publishedCount++;
        }

        logger.debug('Kalshi REST API markets fetched and published', { count: publishedCount });
      });
    } catch (error) {
      logger.error('Failed to fetch Kalshi markets via REST API', { error: String(error) });
      this.rotateRestEndpoint();
    }
  }
}
