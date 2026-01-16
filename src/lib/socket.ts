import { env } from '../config/env';
import { WebSocketMessage } from './websocket-types';

type MessageHandler = (message: WebSocketMessage) => void;
type StatusHandler = (status: 'connected' | 'disconnected' | 'error') => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: number | null = null;
  private subscriptions: Set<string> = new Set();
  private marketSubscriptions: Set<string> = new Set();
  private intentionallyClosed = false;

  constructor(url: string = env.WS_URL) {
    this.url = url;
  }

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.token = token;
      
      try {
        const wsUrl = `${this.url}?token=${encodeURIComponent(token)}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          
          // Reapply all subscriptions after reconnect
          this.subscriptions.forEach(assessmentId => {
            this.sendSubscribe(assessmentId);
          });
          
          this.marketSubscriptions.forEach(market => {
            this.sendMarketSubscribe(market);
          });
          
          this.notifyStatus('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WebSocketMessage;
            this.messageHandlers.forEach(handler => handler(message));
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.notifyStatus('error');
          reject(error);
        };

        this.ws.onclose = () => {
          this.stopHeartbeat();
          this.notifyStatus('disconnected');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.stopHeartbeat();
    this.subscriptions.clear();
    this.marketSubscriptions.clear();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private attemptReconnect(): void {
    if (this.intentionallyClosed) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    setTimeout(() => {
      if (this.token && !this.intentionallyClosed) {
        this.connect(this.token).catch(error => {
          console.error('Reconnection failed:', error);
        });
      }
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private sendSubscribe(assessmentId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        assessment_id: assessmentId,
      }));
    }
  }

  private sendMarketSubscribe(market: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe_market',
        market: market,
      }));
    }
  }

  subscribe(assessmentId: string): void {
    if (this.subscriptions.has(assessmentId)) {
      return;
    }

    this.subscriptions.add(assessmentId);
    this.sendSubscribe(assessmentId);
  }

  unsubscribe(assessmentId: string): void {
    this.subscriptions.delete(assessmentId);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        assessment_id: assessmentId,
      }));
    }
  }

  subscribeToMarket(market: string): void {
    if (this.marketSubscriptions.has(market)) {
      return;
    }

    this.marketSubscriptions.add(market);
    this.sendMarketSubscribe(market);
  }

  unsubscribeFromMarket(market: string): void {
    this.marketSubscriptions.delete(market);
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe_market',
        market: market,
      }));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private notifyStatus(status: 'connected' | 'disconnected' | 'error'): void {
    this.statusHandlers.forEach(handler => handler(status));
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const websocket = new WebSocketClient();
