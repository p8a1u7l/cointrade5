import { StrategyBase } from './StrategyBase.js';

export class MomentumStrategy extends StrategyBase {
  constructor(params = {}) {
    super(params);
    this.minRelVol = params.minRelVol ?? 1.2;
    this.minMovePct = params.minMovePct ?? 0.5; // percent
    this.minEdge = params.minEdge ?? 0.5;
  }

  checkEntry(market) {
    const rv = Number(market.vol_ratio ?? 0);
    const move = Number(market.change_5m_pct ?? 0);
    const edge = Number(market.edge_score ?? 0);

    const strongMove = Math.abs(move) >= this.minMovePct;
    const relVolOk = rv >= this.minRelVol;
    const edgeOk = edge >= this.minEdge;

    const enter = strongMove && relVolOk && edgeOk;
    const reason = enter
      ? `move ${move}% + vol_ratio ${rv} + edge ${edge}`
      : `insufficient momentum (move ${move}%, vol_ratio ${rv}, edge ${edge})`;

    return { enter, reason, meta: { move, rv, edge } };
  }

  checkExit(position, market) {
    // Simple exit: if move reverses more than half the entry move
    const move = Number(market.change_5m_pct ?? 0);
    if (position && Math.sign(move) !== Math.sign(position.entryMove) && Math.abs(move) > Math.abs(position.entryMove) * 0.5) {
      return { exit: true, reason: `momentum reversal ${move}%` };
    }
    return { exit: false };
  }

  checkStopLoss(position, market) {
    const price = Number(market.current_price ?? 0);
    if (!position || !position.entryPrice) return { stop: false };
    const lossPct = ((price - position.entryPrice) / position.entryPrice) * 100 * (position.side === 'long' ? -1 : 1);
    const stop = lossPct <= - (this.params.maxLossPct ?? 2);
    return { stop, reason: stop ? `loss ${lossPct.toFixed(2)}%` : undefined };
  }
}
