import { StrategyBase } from './StrategyBase.js';

export class PriceActionStrategy extends StrategyBase {
  constructor(params = {}) {
    super(params);
  }

  checkEntry(market) {
    // Look for pattern tags in market.local_pattern
    const pattern = market.local_pattern ?? '';
    const bullish = ['hammer', 'bullish_engulfing', 'morning_star'].includes(pattern);
    const bearish = ['shooting_star', 'bearish_engulfing', 'evening_star'].includes(pattern);
    if (bullish) return { enter: true, reason: `pattern ${pattern} bullish`, meta: { pattern } };
    if (bearish) return { enter: true, reason: `pattern ${pattern} bearish`, meta: { pattern } };
    return { enter: false, reason: 'no recognized pattern' };
  }

  checkExit(position, market) {
    // Exit on clear reversal pattern
    const pattern = market.local_pattern ?? '';
    const reversal = ['engulfing_reverse', 'pinbar_reverse'].includes(pattern);
    return { exit: reversal, reason: reversal ? `reversal pattern ${pattern}` : undefined };
  }

  checkStopLoss(position, market) {
    // Tight stop for pattern trades
    if (!position) return { stop: false };
    const stop = market.current_price < (position.entryPrice * 0.995);
    return { stop, reason: stop ? 'pattern failed' : undefined };
  }
}
