import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '__fixtures__/fakeWatcher.js');

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

test('interest hotlist normalises watcher payload and caches results', async (t) => {
  const watcherModule = await import(pathToFileURL(fixturePath).href);
  watcherModule.reset();

  await withEnv(
    {
      BINANCE_API_KEY: 'key',
      BINANCE_API_SECRET: 'secret',
      INTEREST_WATCHER_ENABLED: 'true',
      INTEREST_WATCHER_DIST_MODULE: fixturePath,
      INTEREST_WATCHER_PROJECT_DIR: path.dirname(fixturePath),
      INTEREST_WATCHER_MIN_SCORE: '2.5',
      INTEREST_WATCHER_MAX_SYMBOLS: '5',
      INTEREST_WATCHER_QUOTE_ASSET: 'USDT',
      INTEREST_WATCHER_STALE_MS: String(10 * 60 * 1000),
    },
    async () => {
      const module = await import('../services/interestHotlist.js');
      const {
        getInterestHotlist,
        __resetInterestHotlistCacheForTests,
        setInterestWatcherEnabled,
        getInterestWatcherStatus,
      } = module;

      t.after(() => {
        __resetInterestHotlistCacheForTests();
        watcherModule.reset();
      });

      const first = await getInterestHotlist({ force: true });
      assert.equal(watcherModule.stats.calls, 1);
      assert.equal(first.entries.length, 1);
      const entry = first.entries[0];
      assert.equal(entry.symbol, 'BTC');
      assert.equal(entry.tradingSymbol, 'BTCUSDT');
      assert.equal(entry.score, 3.2);
      assert.equal(entry.z, 3.2);
      assert.equal(entry.metrics.count, 5);

      const cached = await getInterestHotlist();
      assert.equal(watcherModule.stats.calls, 1);
      assert.equal(cached, first);

      const refreshed = await getInterestHotlist({ force: true });
      assert.equal(watcherModule.stats.calls, 2);
      assert.notEqual(refreshed, first);
      assert.equal(refreshed.entries[0].symbol, 'BTC');

      setInterestWatcherEnabled(false);
      const disabled = await getInterestHotlist({ force: true });
      assert.equal(disabled.entries.length, 0);
      assert.equal(watcherModule.stats.calls, 2);
      const disabledStatus = getInterestWatcherStatus();
      assert.equal(disabledStatus.enabled, false);
      assert.equal(disabledStatus.reason?.code, 'disabled');

      setInterestWatcherEnabled(true);
      const reenabled = await getInterestHotlist({ force: true });
      assert.equal(reenabled.entries.length, 1);
      assert.equal(watcherModule.stats.calls, 3);
      const enabledStatus = getInterestWatcherStatus();
      assert.equal(enabledStatus.enabled, true);
      assert.equal(enabledStatus.reason, null);
    },
  );
});

test('trading engine uses scalping as the base strategy while interest watcher toggles', async (t) => {
  await withEnv(
    {
      BINANCE_API_KEY: 'key',
      BINANCE_API_SECRET: 'secret',
      INTEREST_WATCHER_ENABLED: 'true',
    },
    async () => {
      const module = await import('../services/tradingEngine.js');
      const { TradingEngine } = module;

      const engine = new TradingEngine(['BTCUSDT']);
      t.after(() => {
        engine.stop();
      });

      assert.equal(engine.getStrategyMode(), 'scalp');

      const disabled = engine.setInterestWatcherEnabled(false);
      assert.equal(disabled.enabled, false);
      assert.equal(disabled.reason?.code, 'manual-toggle');
      assert.equal(disabled.strategyMode, 'scalp');

      const llmMode = engine.setStrategyMode('llm');
      assert.equal(llmMode, 'llm');
      assert.equal(engine.getStrategyMode(), 'llm');

      const reenabled = engine.setInterestWatcherEnabled(true);
      assert.equal(reenabled.enabled, true);
      assert.equal(reenabled.reason, null);
      assert.equal(reenabled.strategyMode, 'llm');
      assert.equal(engine.getStrategyMode(), 'llm');

      const fallback = engine.setStrategyMode('swing');
      assert.equal(fallback, 'scalp');
      assert.equal(engine.getStrategyMode(), 'scalp');
    },
  );
});

test('interest watcher auto-disables when the module is missing', async (t) => {
  const missingDist = path.resolve(__dirname, '__fixtures__/missing-watcher.js');
  const missingProject = path.resolve(__dirname, '__fixtures__/missing-project');

  const { config } = await import('../config.js');
  const module = await import('../services/interestHotlist.js');
  const {
    getInterestHotlist,
    getInterestWatcherStatus,
    __resetInterestHotlistCacheForTests,
    setInterestWatcherEnabled,
  } = module;

  const previous = {
    enabled: config.interestWatcher.enabled,
    distModule: config.interestWatcher.distModule,
    projectDir: config.interestWatcher.projectDir,
    dataDir: config.interestWatcher.dataDir,
    stateDir: config.interestWatcher.stateDir,
  };

  config.interestWatcher.enabled = true;
  config.interestWatcher.distModule = missingDist;
  config.interestWatcher.projectDir = missingProject;
  config.interestWatcher.dataDir = undefined;
  config.interestWatcher.stateDir = undefined;

  __resetInterestHotlistCacheForTests();
  setInterestWatcherEnabled(true);

  t.after(() => {
    config.interestWatcher.enabled = previous.enabled;
    config.interestWatcher.distModule = previous.distModule;
    config.interestWatcher.projectDir = previous.projectDir;
    config.interestWatcher.dataDir = previous.dataDir;
    config.interestWatcher.stateDir = previous.stateDir;
    __resetInterestHotlistCacheForTests();
  });

  const payload = await getInterestHotlist({ force: true });
  assert.equal(Array.isArray(payload.entries) ? payload.entries.length : 0, 0);

  const status = getInterestWatcherStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.reason?.code, 'missing-module');
  assert.ok(status.reason?.message.includes('Interest watcher module'));

  const second = await getInterestHotlist({ force: true });
  assert.equal(second.entries.length, 0);
});
