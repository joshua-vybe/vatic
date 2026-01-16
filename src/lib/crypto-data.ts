export const CRYPTO_PAIRS = [
  { symbol: "BTC/USDT", name: "Bitcoin" },
  { symbol: "ETH/USDT", name: "Ethereum" },
  { symbol: "SOL/USDT", name: "Solana" },
  { symbol: "BNB/USDT", name: "Binance Coin" },
  { symbol: "XRP/USDT", name: "Ripple" },
  { symbol: "ADA/USDT", name: "Cardano" },
  { symbol: "AVAX/USDT", name: "Avalanche" },
  { symbol: "DOGE/USDT", name: "Dogecoin" },
  { symbol: "DOT/USDT", name: "Polkadot" },
  { symbol: "MATIC/USDT", name: "Polygon" },
  { symbol: "LINK/USDT", name: "Chainlink" },
  { symbol: "UNI/USDT", name: "Uniswap" },
  { symbol: "ATOM/USDT", name: "Cosmos" },
  { symbol: "LTC/USDT", name: "Litecoin" },
  { symbol: "NEAR/USDT", name: "NEAR Protocol" },
  { symbol: "APT/USDT", name: "Aptos" },
  { symbol: "ARB/USDT", name: "Arbitrum" },
  { symbol: "OP/USDT", name: "Optimism" },
  { symbol: "SUI/USDT", name: "Sui" },
  { symbol: "INJ/USDT", name: "Injective" },
]

export const PREDICTION_MARKETS = {
  polymarket: [
    { id: "election-2024", name: "2024 Presidential Election", probability: 0.52 },
    { id: "super-bowl", name: "Super Bowl Winner", probability: 0.48 },
    { id: "world-series", name: "World Series Winner", probability: 0.35 },
    { id: "btc-100k", name: "Bitcoin to $100k in 2024", probability: 0.65 },
  ],
  kalshi: [
    { id: "fed-rate", name: "Fed Rate Decision", probability: 0.72 },
    { id: "recession", name: "US Recession in 2024", probability: 0.28 },
    { id: "inflation", name: "Inflation Below 3%", probability: 0.58 },
    { id: "weather-nyc", name: "NYC Temp Above 90F", probability: 0.42 },
  ],
}
