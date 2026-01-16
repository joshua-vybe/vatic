import { createStore } from 'solid-js/store';
import { Market } from '../types';
import { websocket } from '../lib/socket';

interface MarketDataState {
  prices: Record<string, number>;
  markets: Market[];
  loading: boolean;
  error: string | null;
  activeMarkets: Set<string>;
}

const [marketDataState, setMarketDataState] = createStore<MarketDataState>({
  prices: {},
  markets: [],
  loading: false,
  error: null,
  activeMarkets: new Set(),
});

export const marketDataStore = {
  state: marketDataState,

  subscribeToMarket(market: string) {
    if (marketDataState.activeMarkets.has(market)) {
      return;
    }
    
    marketDataState.activeMarkets.add(market);
    websocket.subscribeToMarket(market);
  },

  unsubscribeFromMarket(market: string) {
    marketDataState.activeMarkets.delete(market);
    websocket.unsubscribeFromMarket(market);
  },

  updatePrice(market: string, price: number) {
    setMarketDataState('prices', p => ({ ...p, [market]: price }));
  },

  setMarkets(markets: Market[]) {
    setMarketDataState('markets', markets);
  },

  getPrice(market: string): number | undefined {
    return marketDataState.prices[market];
  },

  getPrices(): Record<string, number> {
    return { ...marketDataState.prices };
  },

  getMarkets(): Market[] {
    return [...marketDataState.markets];
  },

  getActiveMarkets(): string[] {
    return Array.from(marketDataState.activeMarkets);
  },
};
