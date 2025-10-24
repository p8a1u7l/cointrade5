export class StrategyBase {
  constructor(params = {}) {
    this.params = params;
  }

  // Returns { enter: boolean, reason?: string, meta?: object }
  checkEntry(marketContext) {
    throw new Error('checkEntry not implemented');
  }

  // Returns { exit: boolean, reason?: string, meta?: object }
  checkExit(position, marketContext) {
    throw new Error('checkExit not implemented');
  }

  // Returns { stop: boolean, reason?: string, meta?: object }
  checkStopLoss(position, marketContext) {
    throw new Error('checkStopLoss not implemented');
  }

  // Optional helper for position sizing
  sizePosition(accountBalance, riskPercent) {
    return (accountBalance * (riskPercent / 100));
  }
}
