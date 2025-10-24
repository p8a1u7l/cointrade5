import { BinanceClient } from '../src/clients/binanceClient.js';
import { StrategyExecutor } from '../src/strategies/StrategyExecutor.js';
import {
  MomentumStrategy,
  BreakoutStrategy,
  PullbackStrategy,
  GapStrategy,
  RangeStrategy,
  PriceActionStrategy,
  toStrategyMarketContext,
} from '../src/strategies/index.js';
import { buildSnapshotFromCandles } from '../src/services/marketIntelligence.js';

const SYMBOL = process.argv[2] ?? 'BTCUSDT';
const INTERVAL = process.argv[3] ?? '1m';
const LOOKBACK = Number.isFinite(Number(process.argv[4])) ? Number(process.argv[4]) : 720;

const STRATEGIES = [
  { key: 'momentum', label: 'Momentum', factory: () => new MomentumStrategy() },
  { key: 'breakout', label: 'Breakout', factory: () => new BreakoutStrategy() },
  { key: 'pullback', label: 'Pullback', factory: () => new PullbackStrategy() },
  { key: 'gap', label: 'Gap', factory: () => new GapStrategy() },
  { key: 'range', label: 'Range', factory: () => new RangeStrategy() },
  { key: 'price_action', label: 'Price Action', factory: () => new PriceActionStrategy() },
];

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

async function run() {
  const client = new BinanceClient();
  const candles = await client.fetchKlines(SYMBOL, INTERVAL, LOOKBACK);
  if (!Array.isArray(candles) || candles.length < 80) {
    throw new Error(`Not enough candles returned for ${SYMBOL} (${candles?.length ?? 0})`);
  }

  const warmup = Math.min(80, Math.floor(candles.length * 0.2));
  const results = [];

  for (const config of STRATEGIES) {
    const executor = new StrategyExecutor(config.factory(), { startingBalance: 10_000, riskPercent: 1 });
    for (let index = warmup; index < candles.length; index += 1) {
      const slice = candles.slice(0, index + 1);
      const snapshot = buildSnapshotFromCandles(SYMBOL, INTERVAL, slice);
      const market = toStrategyMarketContext(snapshot);
      executor.onTick(market);
    }
    const summary = executor.summary();
    results.push({ config, summary });
  }

  console.log(`\n=== Backtest Results (${SYMBOL} ${INTERVAL}, ${LOOKBACK} candles) ===`);
  for (const { config, summary } of results) {
    console.log(
      `${config.label.padEnd(14)} | trades ${summary.trades
        .toString()
        .padStart(3)} | wins ${summary.wins.toString().padStart(3)} | losses ${summary.losses
        .toString()
        .padStart(3)} | pnl ${formatNumber(summary.pnl)} | balance ${formatNumber(summary.balance)} | drawdown ${formatNumber(summary.maxDraw)}`
    );
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Backtest failed:', error?.message ?? error);
  process.exit(1);
});
