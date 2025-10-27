import assert from 'node:assert/strict';
import test from 'node:test';

async function importHotlistModule() {
  return await import('../services/interestHotlist.js');
}

async function withEnv(overrides, fn) {
  const backup = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    backup.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of backup.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('interest hotlist builds volatility entries and caches results', async (t) => {
  await withEnv(
    {
      BINANCE_API_KEY: 'key',
      BINANCE_API_SECRET: 'secret',
    },
    async () => {
      const module = await importHotlistModule();
      const {
        getInterestHotlist,
        __resetInterestHotlistCacheForTests,
        __setInterestHotlistProviderForTests,
      } = module;

      t.after(() => {
        __setInterestHotlistProviderForTests(null);
        __resetInterestHotlistCacheForTests();
      });

      const firstSnapshot = [
        {
          symbol: 'BTCUSDT',
          quoteAsset: 'USDT',
          priceChangePercent: 8.2,
          quoteVolume: 1_200_000_000,
          baseVolume: 32_000,
          volatilityPct: 12.4,
          score: 48.6,
          direction: 'up',
        },
        {
          symbol: 'ETHUSDT',
          quoteAsset: 'USDT',
          priceChangePercent: -6.1,
          quoteVolume: 820_000_000,
          baseVolume: 45_000,
          volatilityPct: 9.8,
          direction: 'down',
        },
      ];

      let calls = 0;
      __setInterestHotlistProviderForTests(async () => {
        calls += 1;
        return firstSnapshot;
      });

      const first = await getInterestHotlist({ force: true });
      assert.equal(first.entries.length, 2);
      assert.equal(first.entries[0].tradingSymbol, 'BTCUSDT');
      assert.equal(first.entries[0].direction, 'up');
      assert.ok(first.entries[0].score > first.entries[1].score);
      assert.equal(first.entries[1].tradingSymbol, 'ETHUSDT');
      assert.equal(first.entries[1].direction, 'down');
      assert.ok(Array.isArray(first.entries[0].reasons));
      assert.ok(first.entries[0].reasons.length > 0);
      assert.equal(calls, 1);

      const cached = await getInterestHotlist();
      assert.equal(cached, first);
      assert.equal(calls, 1);

      const refreshedSnapshot = [
        {
          symbol: 'SOLUSDT',
          quoteAsset: 'USDT',
          priceChangePercent: 11.2,
          quoteVolume: 560_000_000,
          baseVolume: 18_500,
          volatilityPct: 15.3,
          direction: 'up',
        },
      ];

      __setInterestHotlistProviderForTests(async () => refreshedSnapshot);
      const refreshed = await getInterestHotlist({ force: true });
      assert.notEqual(refreshed, first);
      assert.equal(refreshed.entries.length, 1);
      assert.equal(refreshed.entries[0].tradingSymbol, 'SOLUSDT');
      assert.ok(refreshed.updatedAt >= first.updatedAt);
    },
  );
});

test('interest hotlist module no longer exposes watcher controls', async () => {
  await withEnv(
    {
      BINANCE_API_KEY: 'key',
      BINANCE_API_SECRET: 'secret',
    },
    async () => {
      const module = await importHotlistModule();

      assert.equal('setInterestWatcherEnabled' in module, false);
      assert.equal('getInterestWatcherStatus' in module, false);
      assert.equal('isInterestWatcherEnabled' in module, false);
    },
  );
});

test('trading engine keeps scalping as the base strategy without interest watcher controls', async (t) => {
  await withEnv(
    {
      BINANCE_API_KEY: 'key',
      BINANCE_API_SECRET: 'secret',
    },
    async () => {
      const module = await import('../services/tradingEngine.js');
      const { TradingEngine } = module;

      const engine = new TradingEngine(['BTCUSDT']);
      t.after(() => {
        engine.stop();
      });

      assert.equal(engine.getStrategyMode(), 'scalp');

      const llmMode = engine.setStrategyMode('llm');
      assert.equal(llmMode, 'llm');
      assert.equal(engine.getStrategyMode(), 'llm');

      const fallback = engine.setStrategyMode('swing');
      assert.equal(fallback, 'scalp');
      assert.equal(engine.getStrategyMode(), 'scalp');
    },
  );
});

test('trading engine falls back to volatility hotlist when legacy watcher fails', async (t) => {
  await withEnv(
    {
      BINANCE_API_KEY: 'key',
      BINANCE_API_SECRET: 'secret',
    },
    async () => {
      const binanceModule = await import('../clients/binanceClient.js');

      const watcherError = new Error(
        'Interest watcher module could not be loaded. Run "npm run build --prefix zenith" to compile the interest watcher.',
      );
      const fallbackMovers = [
        {
          symbol: 'BTCUSDT',
          quoteAsset: 'USDT',
          priceChangePercent: 6.4,
          quoteVolume: 960_000_000,
          baseVolume: 28_500,
          volatilityPct: 12.1,
          direction: 'up',
        },
        {
          symbol: 'ETHUSDT',
          quoteAsset: 'USDT',
          priceChangePercent: -4.2,
          quoteVolume: 520_000_000,
          baseVolume: 18_200,
          volatilityPct: 9.3,
          direction: 'down',
        },
      ];

      const fetchTopMovers = t.mock.method(
        binanceModule.BinanceClient.prototype,
        'fetchTopMovers',
        async () => fallbackMovers,
      );

      const { TradingEngine } = await import('../services/tradingEngine.js');
      const engine = new TradingEngine(['BTCUSDT']);
      const originalGetHotlist = engine._getInterestHotlist;
      engine._getInterestHotlist = async () => {
        throw watcherError;
      };
      const originalUpdateInterest = engine._updateScalpInterest;
      let interestUpdates = 0;
      engine._updateScalpInterest = async () => {
        interestUpdates += 1;
      };

      t.after(() => {
        engine.stop();
        engine._getInterestHotlist = originalGetHotlist;
        engine._updateScalpInterest = originalUpdateInterest;
        fetchTopMovers.mock.restore();
      });

      const snapshot = await engine.refreshInterestHotlist(true);
      assert.equal(fetchTopMovers.mock.callCount(), 1);
      assert.equal(interestUpdates, 1);
      assert.equal(snapshot.entries.length, 2);
      assert.equal(snapshot.entries[0].tradingSymbol, 'BTCUSDT');
      assert.equal(snapshot.entries[1].tradingSymbol, 'ETHUSDT');
      assert.ok(snapshot.updatedAt > 0);
    },
  );
});
