import { StrategyBase } from './StrategyBase.js';

export class PullbackStrategy extends StrategyBase {
  constructor(params = {}) {
    super(params);
    this.maPeriod = params.maPeriod ?? 20;
  }

  checkEntry(market) {
    // Simple heuristic: price near moving average and shows reversal candle
    const price = Number(market.current_price ?? 0);
    const ma = Number(market.ma ?? 0);
    const nearMA = ma > 0 && Math.abs((price - ma) / ma) * 100 < 0.5;
    const reversed = Boolean(market.local_signal === 'bounce' || market.local_signal === 'reversal');
    const enter = nearMA && reversed;
    const reason = enter ? `near MA ${ma} with ${market.local_signal}` : `not near MA or no reversal signal`;
    return { enter, reason, meta: { price, ma, local_signal: market.local_signal } };
  }

  checkExit(position, market) {
    // Exit when reaching prior swing high
    if (!position) return { exit: false };
    const prevSwing = Number(market.prev_swing_high ?? 0);
    if (prevSwing > 0 && market.current_price >= prevSwing) return { exit: true, reason: 'reached prev swing' };
    return { exit: false };
  }

  checkStopLoss(position, market) {
    if (!position) return { stop: false };
    const stop = market.current_price <= (position.entryPrice * 0.995);
    return { stop, reason: stop ? 'breach below stop' : undefined };
  }
}
