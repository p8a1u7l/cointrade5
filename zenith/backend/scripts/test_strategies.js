import {
  MomentumStrategy,
  BreakoutStrategy,
  PullbackStrategy,
  GapStrategy,
  RangeStrategy,
  PriceActionStrategy,
} from '../src/strategies/index.js';

const mockMarketStrong = {
  rsi_14: 65.8,
  change_5m_pct: 0.82,
  vol_ratio: 1.45,
  edge_score: 0.68,
  current_price: 34250.5,
  price_change_24h: 2.5,
  volume_24h: 12500000000,
  high_24h: 34500.0,
  low_24h: 33200.0,
  avg_volume_24h: 8000000000,
  local_signal: 'bounce',
  ma: 34180.0,
  prev_swing_high: 34400.0,
  prev_close: 33900.0,
  open_price: 34050.0,
  local_pattern: 'hammer',
  support: 34000.0,
  resistance: 34600.0,
};

const mockMarketWeak = {
  rsi_14: 50,
  change_5m_pct: 0.05,
  vol_ratio: 0.7,
  edge_score: 0.2,
  current_price: 100,
  avg_volume_24h: 1000000,
  volume_24h: 600000,
  local_signal: 'none',
  ma: 101,
  prev_swing_high: 105,
  prev_close: 99,
  open_price: 100.5,
  local_pattern: 'none',
  support: 95,
  resistance: 110,
};

async function run() {
  const strategies = [
    { name: 'Momentum', cls: MomentumStrategy },
    { name: 'Breakout', cls: BreakoutStrategy },
    { name: 'Pullback', cls: PullbackStrategy },
    { name: 'Gap', cls: GapStrategy },
    { name: 'Range', cls: RangeStrategy },
    { name: 'PriceAction', cls: PriceActionStrategy },
  ];

  console.log('\n=== Running strategies against STRONG market ===');
  for (const s of strategies) {
    const inst = new s.cls();
    try {
      const res = inst.checkEntry(mockMarketStrong);
      console.log(`${s.name} -> enter: ${res.enter}, reason: ${res.reason}`);
    } catch (e) {
      console.error(`${s.name} error:`, e.message);
    }
  }

  console.log('\n=== Running strategies against WEAK market ===');
  for (const s of strategies) {
    const inst = new s.cls();
    try {
      const res = inst.checkEntry(mockMarketWeak);
      console.log(`${s.name} -> enter: ${res.enter}, reason: ${res.reason}`);
    } catch (e) {
      console.error(`${s.name} error:`, e.message);
    }
  }
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
