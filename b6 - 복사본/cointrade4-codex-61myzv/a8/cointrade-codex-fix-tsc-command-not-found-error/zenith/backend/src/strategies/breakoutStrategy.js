import { StrategyBase } from './StrategyBase.js';

export class BreakoutStrategy extends StrategyBase {
  constructor(params = {}) {
    super(params);
    this.volMultiplier = params.volMultiplier ?? 1.5;
  }

  checkEntry(market) {
    const vol = Number(market.volume_24h ?? 0);
    const avgVol = Number(market.avg_volume_24h ?? 0);
    const rel = avgVol > 0 ? vol / avgVol : 0;
    const brokeHigh = Boolean(market.price > market.high_24h);

    const enter = brokeHigh && rel >= this.volMultiplier;
    const reason = enter
      ? `breakout above high with relVol ${rel.toFixed(2)}`
      : `no confirmed breakout (brokeHigh:${brokeHigh}, relVol:${rel.toFixed(2)})`;
    return { enter, reason, meta: { rel, brokeHigh } };
  }

  checkExit(position, market) {
    // Exit at next resistance approximated by high_24h * 1.01
    const target = Number(market.high_24h ?? 0) * 1.01;
    if (market.current_price >= target) return { exit: true, reason: 'target reached' };
    return { exit: false };
  }

  checkStopLoss(position, market) {
    const stop = market.current_price < (position.entryPrice * 0.995);
    return { stop, reason: stop ? 'dropped below 0.5% from entry' : undefined };
  }
}
