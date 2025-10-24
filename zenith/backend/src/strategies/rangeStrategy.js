import { StrategyBase } from './StrategyBase.js';

export class RangeStrategy extends StrategyBase {
  constructor(params = {}) {
    super(params);
    this.rangePct = params.rangePct ?? 2; // percent
  }

  checkEntry(market) {
    const price = Number(market.current_price ?? 0);
    const support = Number(market.support ?? 0);
    const resistance = Number(market.resistance ?? 0);
    if (!support || !resistance) return { enter: false, reason: 'no defined range' };
    const nearSupport = price <= support * 1.01;
    const nearResistance = price >= resistance * 0.99;
    if (nearSupport) return { enter: true, reason: 'buy at support', meta: { support } };
    if (nearResistance) return { enter: true, reason: 'short at resistance', meta: { resistance } };
    return { enter: false, reason: 'not near boundaries' };
  }

  checkExit(position, market) {
    const price = Number(market.current_price ?? 0);
    if (!position) return { exit: false };
    if (position.side === 'long' && price >= (market.resistance ?? 0)) return { exit: true, reason: 'target at resistance' };
    if (position.side === 'short' && price <= (market.support ?? 0)) return { exit: true, reason: 'target at support' };
    return { exit: false };
  }

  checkStopLoss(position, market) {
    if (!position) return { stop: false };
    const stop = position.side === 'long' ? market.current_price < (position.entryPrice * 0.995) : market.current_price > (position.entryPrice * 1.005);
    return { stop, reason: stop ? 'range breach' : undefined };
  }
}
