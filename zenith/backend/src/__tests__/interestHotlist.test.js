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

test('interest hotlist stub returns empty payload and caches results', async (t) => {
  const module = await importHotlistModule();
  const { getInterestHotlist, __resetInterestHotlistCacheForTests } = module;

  t.after(() => {
    __resetInterestHotlistCacheForTests();
  });

  const first = await getInterestHotlist({ force: true });
  assert.deepEqual(first.entries, []);
  assert.deepEqual(first.totals, []);
  assert.ok(Number.isFinite(first.updatedAt));

  const cached = await getInterestHotlist();
  assert.equal(cached, first);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const refreshed = await getInterestHotlist({ force: true });
  assert.notEqual(refreshed, first);
  assert.deepEqual(refreshed.entries, []);
  assert.ok(refreshed.updatedAt >= first.updatedAt);
});

test('interest watcher status always reports disabled', async () => {
  const module = await importHotlistModule();
  const { getInterestWatcherStatus, isInterestWatcherEnabled, setInterestWatcherEnabled } = module;

  assert.equal(isInterestWatcherEnabled(), false);
  const initialStatus = getInterestWatcherStatus();
  assert.equal(initialStatus.enabled, false);
  assert.equal(initialStatus.reason?.code, 'removed');

  const toggledOn = setInterestWatcherEnabled(true);
  assert.equal(toggledOn.enabled, false);
  assert.equal(toggledOn.reason?.code, 'removed');

  const toggledOff = setInterestWatcherEnabled(false);
  assert.equal(toggledOff.enabled, false);
  assert.equal(toggledOff.reason?.code, 'removed');
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
