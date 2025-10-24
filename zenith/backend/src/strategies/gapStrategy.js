import { StrategyBase } from './StrategyBase.js';

export class GapStrategy extends StrategyBase {
  constructor(params = {}) {
    super(params);
    this.minGapPct = params.minGapPct ?? 1.0;
  }

  checkEntry(market) {
    const prevClose = Number(market.prev_close ?? 0);
    const open = Number(market.open_price ?? market.current_price ?? 0);
    if (!prevClose) return { enter: false, reason: 'no prev close' };
    const gapPct = ((open - prevClose) / prevClose) * 100;
    const enter = Math.abs(gapPct) >= this.minGapPct;
    const reason = enter ? `gap ${gapPct.toFixed(2)}%` : `gap too small (${gapPct.toFixed(2)}%)`;
    return { enter, reason, meta: { gapPct } };
  }

  checkExit(position, market) {
    // Exit if gap fills by 50%
    const prevClose = Number(market.prev_close ?? 0);
    const cur = Number(market.current_price ?? 0);
    if (!prevClose) return { exit: false };
    const gapFullPct = ((cur - prevClose) / prevClose) * 100;
    if (Math.abs(gapFullPct) < Math.abs((position.entryPrice - prevClose) / prevClose) * 0.5) {
      return { exit: true, reason: 'gap partially filled' };
    }
    return { exit: false };
  }

  checkStopLoss(position, market) {
    const stop = market.current_price < (position.entryPrice * 0.99);
    return { stop, reason: stop ? 'deep move against gap' : undefined };
  }
}
