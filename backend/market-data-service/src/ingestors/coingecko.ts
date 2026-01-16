import axios from 'axios';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { publishEvent, TOPIC_BTC_TICKS, TOPIC_ETH_TICKS, TOPIC_SOL_TICKS, TOPIC_CRYPTO_TICKS } from '../utils/kafka';
import { cacheMarketPrice } from '../utils/redis';
import { createLogger } from '../utils/logger';
import { incrementPublishCount, incrementPublishErrors, updatePublishLatency, setIngestorRunning, setCircuitBreakerState } from '../utils/metrics';

const logger = createLogger('coingecko-ingestor');

const CRYPTO_PAIRS = [
  'bitcoin',
  'ethereum',
  'solana',
  'cardano',
  'polkadot',
  'ripple',
  'litecoin',
  'dogecoin',
  'polygon',
  'avalanche-2',
  'chainlink',
  'uniswap',
  'aave',
  'curve-dao-token',
  'yearn-finance',
  'maker',
  'compound',
  'balancer',
  'synthetix',
  'optimism',
  'arbitrum',
  'cosmos',
  'near-protocol',
  'fantom',
  'harmony',
  'celo',
  'algorand',
  'tezos',
  'elrond',
  'hedera-hashgraph',
  'iota',
  'vechain',
  'theta-token',
  'eos',
  'tron',
  'stellar',
  'monero',
  'zcash',
  'dash',
  'bitcoin-cash',
  'litecoin-cash',
  'dogecoin',
  'shiba-inu',
  'pepe',
  'floki',
  'doge-killer',
  'safemoon',
  'baby-doge-coin',
  'kishu-inu',
  'akita-inu',
  'saitama',
];

const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3/simple/price';
const COINMARKETCAP_API_URL = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest';
const COINGECKO_BACKUP_URL = 'https://api.coingecko.com/api/v3/simple/price';

// Map specific coins to their dedicated topics
const TOPIC_MAP: { [key: string]: string } = {
  bitcoin: TOPIC_BTC_TICKS,
  ethereum: TOPIC_ETH_TICKS,
  solana: TOPIC_SOL_TICKS,
};

// Map specific coins to their market symbols
const MARKET_MAP: { [key: string]: string } = {
  bitcoin: 'BTC/USD',
  ethereum: 'ETH/USD',
  solana: 'SOL/USD',
};

export class CoingeckoIngestor {
  private circuitBreaker: CircuitBreaker;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private apiKey?: string;
  private currentApiUrl: string = COINGECKO_API_URL;
  private endpoints: string[] = [COINGECKO_API_URL];
  private currentEndpointIndex: number = 0;
  private coinmarketcapApiKey?: string;

  constructor(apiKey?: string, coinmarketcapApiKey?: string) {
    this.circuitBreaker = new CircuitBreaker('coingecko', 3, 60000);
    this.apiKey = apiKey;
    this.coinmarketcapApiKey = coinmarketcapApiKey;
    // Only add CoinMarketCap to endpoints if API key is configured
    if (coinmarketcapApiKey) {
      this.endpoints.push(COINMARKETCAP_API_URL);
    }
    this.currentApiUrl = this.endpoints[0];
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Coingecko ingestor already running');
      return;
    }

    this.isRunning = true;
    setIngestorRunning('coingecko', true);
    logger.info('Starting Coingecko ingestor');

    this.intervalId = setInterval(async () => {
      await this.fetchAndPublish();
    }, 1000);
  }

  private async fetchAndPublish(): Promise<void> {
    try {
      await this.circuitBreaker.execute(async () => {
        // Use different API based on current endpoint
        if (this.currentApiUrl === COINMARKETCAP_API_URL) {
          await this.fetchFromCoinMarketCap();
        } else {
          await this.fetchFromCoingecko();
        }
      });
      setCircuitBreakerState('coingecko', this.circuitBreaker.getState());
    } catch (error) {
      logger.error('Failed to fetch prices', { error: String(error) });
      setCircuitBreakerState('coingecko', this.circuitBreaker.getState());
      this.rotateEndpoint();
    }
  }

  private async fetchFromCoingecko(): Promise<void> {
    const params = new URLSearchParams({
      ids: CRYPTO_PAIRS.join(','),
      vs_currencies: 'usd',
    });

    if (this.apiKey) {
      params.append('x_cg_pro_api_key', this.apiKey);
    }

    const response = await axios.get(`${this.currentApiUrl}?${params.toString()}`);
    const data = response.data;

    let publishedCount = 0;

    for (const [coin, prices] of Object.entries(data)) {
      const priceData = prices as { usd: number };
      const price = priceData.usd;

      const topic = TOPIC_MAP[coin] || TOPIC_CRYPTO_TICKS;
      const market = MARKET_MAP[coin] || `${coin.toUpperCase()}/USD`;

      const message = {
        market,
        price,
        timestamp: Date.now(),
      };

      const result = await publishEvent(topic, message);
      if (result.success) {
        incrementPublishCount();
        updatePublishLatency(result.latency);
      } else {
        incrementPublishErrors();
      }

      await cacheMarketPrice(market, price, 1);
      publishedCount++;
    }

    logger.info('Coingecko prices fetched and published', { count: publishedCount });
  }

  private async fetchFromCoinMarketCap(): Promise<void> {
    if (!this.coinmarketcapApiKey) {
      throw new Error('CoinMarketCap API key not configured');
    }

    const response = await axios.get(this.currentApiUrl, {
      headers: {
        'X-CMC_PRO_API_KEY': this.coinmarketcapApiKey,
      },
      params: {
        symbol: CRYPTO_PAIRS.map((p) => p.toUpperCase()).join(','),
        convert: 'USD',
      },
    });

    const data = response.data.data;
    let publishedCount = 0;

    for (const [symbol, coinData] of Object.entries(data)) {
      const coin = symbol.toLowerCase();
      const price = (coinData as any).quote?.USD?.price;

      if (!price) continue;

      const topic = TOPIC_MAP[coin] || TOPIC_CRYPTO_TICKS;
      const market = MARKET_MAP[coin] || `${symbol}/USD`;

      const message = {
        market,
        price,
        timestamp: Date.now(),
      };

      const result = await publishEvent(topic, message);
      if (result.success) {
        incrementPublishCount();
        updatePublishLatency(result.latency);
      } else {
        incrementPublishErrors();
      }

      await cacheMarketPrice(market, price, 1);
      publishedCount++;
    }

    logger.info('CoinMarketCap prices fetched and published', { count: publishedCount });
  }

  private rotateEndpoint(): void {
    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.endpoints.length;
    this.currentApiUrl = this.endpoints[this.currentEndpointIndex];
    logger.info('Rotated to next Coingecko endpoint', {
      endpoint: this.currentApiUrl,
      index: this.currentEndpointIndex,
    });
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    setIngestorRunning('coingecko', false);
    logger.info('Coingecko ingestor stopped');
  }

  getState(): string {
    return this.isRunning ? 'running' : 'stopped';
  }

  getCircuitBreakerState(): string {
    return this.circuitBreaker.getState();
  }
}
