import { createStore } from 'solid-js/store';
import { createMemo } from 'solid-js';
import { Position, Trade, Order } from '../types';
import * as tradingApi from '../lib/api/trading';

interface TradingState {
  positions: Position[];
  trades: Trade[];
  pendingOrders: Order[];
  loading: boolean;
  error: string | null;
}

const [tradingState, setTradingState] = createStore<TradingState>({
  positions: [],
  trades: [],
  pendingOrders: [],
  loading: false,
  error: null,
});

export const tradingStore = {
  state: tradingState,

  async placeOrder(order: tradingApi.PlaceOrderRequest) {
    setTradingState('loading', true);
    setTradingState('error', null);
    
    try {
      const result = await tradingApi.placeOrder(order);
      setTradingState('pendingOrders', orders => [...orders, result]);
      setTradingState('loading', false);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to place order';
      setTradingState({
        error: message,
        loading: false,
      });
      throw error;
    }
  },

  async fetchPositions(assessmentId: string) {
    setTradingState('loading', true);
    setTradingState('error', null);
    
    try {
      const positions = await tradingApi.getPositions(assessmentId);
      setTradingState('positions', positions);
      setTradingState('loading', false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch positions';
      setTradingState({
        error: message,
        loading: false,
      });
    }
  },

  async fetchTrades(assessmentId: string) {
    setTradingState('loading', true);
    setTradingState('error', null);
    
    try {
      const trades = await tradingApi.getTrades(assessmentId);
      setTradingState('trades', trades);
      setTradingState('loading', false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch trades';
      setTradingState({
        error: message,
        loading: false,
      });
    }
  },

  async closePosition(positionId: string) {
    setTradingState('loading', true);
    
    try {
      const position = await tradingApi.closePosition(positionId);
      setTradingState('positions', positions =>
        positions.map(p => p.id === positionId ? position : p)
      );
      setTradingState('loading', false);
      return position;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to close position';
      setTradingState({
        error: message,
        loading: false,
      });
      throw error;
    }
  },

  updatePositionsFromWebSocket(positions: Position[]) {
    setTradingState('positions', positions);
  },

  getTotalExposure: createMemo(() => {
    return tradingState.positions.reduce((sum, pos) => sum + (pos.size * pos.entry_price), 0);
  }),

  getTotalPnL: createMemo(() => {
    return tradingState.positions.reduce((sum, pos) => sum + pos.pnl, 0);
  }),
};
