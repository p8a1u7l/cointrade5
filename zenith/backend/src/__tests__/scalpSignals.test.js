import test from 'node:test';
import assert from 'node:assert/strict';

// The scalping signals loader should transparently bundle the TypeScript sources
// when a prebuilt dist artifact is unavailable.
test('scalping signals module loads via bundled fallback', async () => {
  const module = await import('../services/scalpSignals.js');
  assert.equal(typeof module.updateScalpInterest, 'function');

  await assert.doesNotReject(async () => {
    await module.updateScalpInterest([
      { symbol: 'BTCUSDT', tradingSymbol: 'BTCUSDT', score: 4.2, updatedAt: Date.now() },
    ]);
  });
});
