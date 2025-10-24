export class StrategyExecutor {
  constructor(strategyInstance, options = {}) {
    this.strategy = strategyInstance;
    this.balance = options.startingBalance ?? 10000;
    this.riskPercent = options.riskPercent ?? 1; // percent per trade
    this.position = null; // { side: 'long'|'short', entryPrice, entryTime, entryMove }
    this.trades = []; // record of closed trades
  }

  // Simulate placing an order by creating a position
  enter(positionSide, entryPrice, meta = {}) {
    if (this.position) return false; // only one position at a time in this simple executor
    this.position = {
      side: positionSide,
      entryPrice: Number(entryPrice),
      entryTime: Date.now(),
      entryMove: meta.entryMove ?? 0,
    };
    return true;
  }

  // Close position and record trade result
  exit(exitPrice, reason = 'closed') {
    if (!this.position) return false;
    const entry = this.position.entryPrice;
    const side = this.position.side;
    const pnl = side === 'long' ? exitPrice - entry : entry - exitPrice;
    const pct = (pnl / entry) * 100;
    this.trades.push({ entry, exit: exitPrice, side, pnl, pct, reason, time: Date.now() });
    // simple balance update using full trade size = balance * (riskPercent/100)
    const size = this.balance * (this.riskPercent / 100);
    // assume pnl is proportionate to size/entry (very simplified)
    const valueChange = (pnl / entry) * size;
    this.balance += valueChange;
    this.position = null;
    return true;
  }

  // Called on each market tick
  onTick(market) {
    // If no position, ask strategy for entry
    if (!this.position) {
      const res = this.strategy.checkEntry(market);
      if (res && res.enter) {
        // decide side based on move sign or market signal
        const side = (market.change_5m_pct ?? 0) >= 0 ? 'long' : 'short';
        this.enter(side, Number(market.current_price ?? market.open_price ?? 0), { entryMove: market.change_5m_pct });
      }
      return;
    }

    // If have position, evaluate exit and stop-loss
    const exitRes = this.strategy.checkExit(this.position, market);
    if (exitRes && exitRes.exit) {
      this.exit(Number(market.current_price ?? 0), exitRes.reason ?? 'exit');
      return;
    }

    const stopRes = this.strategy.checkStopLoss(this.position, market);
    if (stopRes && stopRes.stop) {
      this.exit(Number(market.current_price ?? 0), stopRes.reason ?? 'stoploss');
      return;
    }
  }

  summary() {
    const wins = this.trades.filter((t) => t.pnl > 0).length;
    const losses = this.trades.filter((t) => t.pnl <= 0).length;
    const total = this.trades.length;
    const pnl = this.trades.reduce((s, t) => s + t.pnl, 0);
    const maxDraw = this._calcMaxDrawdown();
    return { balance: this.balance, trades: total, wins, losses, pnl, maxDraw };
  }

  _calcMaxDrawdown() {
    // compute drawdown on equity curve derived from trades
    let peak = this.balance;
    let draw = 0;
    let equity = this.balance;
    for (const t of this.trades) {
      equity += t.pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > draw) draw = dd;
    }
    return draw;
  }
}
