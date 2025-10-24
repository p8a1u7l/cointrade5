import { MomentumStrategy } from './momentumStrategy.js';
import { BreakoutStrategy } from './breakoutStrategy.js';
import { PullbackStrategy } from './pullbackStrategy.js';
import { GapStrategy } from './gapStrategy.js';
import { RangeStrategy } from './rangeStrategy.js';
import { PriceActionStrategy } from './priceActionStrategy.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const DEFAULT_STRATEGY_DEFS = [
  {
    key: 'momentum',
    label: 'Momentum',
    factory: (params = {}) => new MomentumStrategy(params),
    params: { minRelVol: 1.2, minMovePct: 0.5, minEdge: 0.5 },
  },
  {
    key: 'breakout',
    label: 'Breakout',
    factory: (params = {}) => new BreakoutStrategy(params),
    params: { volMultiplier: 1.5 },
  },
  {
    key: 'pullback',
    label: 'Pullback',
    factory: (params = {}) => new PullbackStrategy(params),
    params: { maPeriod: 20 },
  },
  {
    key: 'gap',
    label: 'Gap',
    factory: (params = {}) => new GapStrategy(params),
    params: { minGapPct: 1 },
  },
  {
    key: 'range',
    label: 'Range',
    factory: (params = {}) => new RangeStrategy(params),
    params: { rangePct: 2 },
  },
  {
    key: 'price_action',
    label: 'Price Action',
    factory: (params = {}) => new PriceActionStrategy(params),
    params: {},
  },
];

const BULLISH_PATTERNS = new Set(['hammer', 'bullish_engulfing', 'morning_star', 'piercing']);
const BEARISH_PATTERNS = new Set(['shooting_star', 'bearish_engulfing', 'evening_star', 'dark_cloud']);

const LOCAL_BULLISH_HINTS = new Set(['bounce', 'reversal', 'bullish', 'support']);
const LOCAL_BEARISH_HINTS = new Set(['selloff', 'breakdown', 'bearish', 'resistance']);

const POSITION_EPSILON = 1e-8;

function parsePromptContext(raw) {
  if (!raw || typeof raw !== 'string') {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
}

function extractPrevClose(candles) {
  if (!Array.isArray(candles) || candles.length < 2) {
    return undefined;
  }
  return toNumber(candles[candles.length - 2]?.close);
}

function extractOpenPrice(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return undefined;
  }
  return toNumber(candles[candles.length - 1]?.open);
}

export function toStrategyMarketContext(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const metrics = snapshot.metrics ?? {};
  const context = parsePromptContext(snapshot.promptContext);
  const candles = Array.isArray(snapshot.candles) ? snapshot.candles : [];
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;

  const localSignal = metrics.localSignal ?? context.local_signal ?? {};
  const ticker = context.ticker_24h ?? {};

  const market = {
    symbol: snapshot.symbol,
    current_price: toNumber(metrics.lastPrice ?? context.price ?? (lastCandle?.close)),
    change_1m_pct: toNumber(metrics.change1mPct ?? context.change_1m_pct),
    change_5m_pct: toNumber(metrics.change5mPct ?? context.change_5m_pct),
    change_15m_pct: toNumber(metrics.change15mPct ?? context.change_15m_pct),
    vol_ratio: toNumber(metrics.volumeRatio ?? context.vol_ratio ?? 1),
    vol_change_pct: toNumber(metrics.volumeChangePct ?? context.vol_change_pct),
    vol_accel_pct: toNumber(metrics.volumeAccelerationPct ?? context.vol_accel_pct),
    edge_score: toNumber(localSignal.edgeScore ?? context.edge_score ?? 0.45),
    rsi_14: toNumber(metrics.rsi14 ?? context.rsi_14 ?? 50),
    price_change_24h: toNumber(ticker.change_pct),
    volume_24h: toNumber(ticker.quote_volume ?? ticker.volume),
    avg_volume_24h: toNumber(ticker.quote_volume ?? ticker.volume),
    high_24h: toNumber(ticker.high ?? metrics.high24h),
    low_24h: toNumber(ticker.low ?? metrics.low24h),
    ma: toNumber(metrics.ema21 ?? context.ema_21),
    prev_swing_high: toNumber(metrics.resistance ?? context.resistance),
    prev_swing_low: toNumber(metrics.support ?? context.support),
    prev_close: extractPrevClose(candles) ?? toNumber(context.prev_close ?? ticker.prev_close),
    open_price: extractOpenPrice(candles) ?? toNumber(context.open_price ?? ticker.open),
    local_signal: typeof localSignal.bias === 'string' ? localSignal.bias.toLowerCase() : undefined,
    local_signal_confidence: toNumber(localSignal.confidence),
    local_signal_reasoning: localSignal.reasoning,
    local_pattern: typeof context.local_pattern === 'string' ? context.local_pattern.toLowerCase() : undefined,
    support: toNumber(metrics.support ?? context.support),
    resistance: toNumber(metrics.resistance ?? context.resistance),
    atr_pct: toNumber(metrics.atrPct ?? context.atr_pct),
  };

  return market;
}

export class StrategyTradeAdapter {
  constructor(options = {}) {
    const strategyDefs = Array.isArray(options.strategies) && options.strategies.length > 0
      ? options.strategies
      : DEFAULT_STRATEGY_DEFS;

    this.logger = options.logger ?? console;
    this.strategies = new Map();
    for (const def of strategyDefs) {
      if (!def || !def.key) continue;
      const strategy = def.instance ?? def.factory?.(def.params) ?? null;
      if (!strategy) continue;
      this.strategies.set(def.key, {
        key: def.key,
        label: def.label ?? def.key,
        instance: strategy,
        params: def.params ?? {},
      });
    }
    this.activePositions = new Map();
  }

  static defaultStrategyConfigs() {
    return DEFAULT_STRATEGY_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      params: { ...(def.params ?? {}) },
    }));
  }

  evaluate(symbol, snapshot, position) {
    if (!this.strategies.size) {
      return null;
    }
    const market = toStrategyMarketContext(snapshot);
    if (!market || !Number.isFinite(market.current_price) || market.current_price <= 0) {
      return null;
    }

    const managed = this.activePositions.get(symbol);
    const hasLivePosition = position && Number.isFinite(position.quantity) && position.quantity > POSITION_EPSILON;

    if (hasLivePosition && !managed) {
      return null;
    }

    if (!hasLivePosition && managed) {
      this.activePositions.delete(symbol);
    }

    if (hasLivePosition && managed) {
      return this.evaluateExit(symbol, market, position, managed);
    }

    if (!hasLivePosition) {
      return this.evaluateEntries(symbol, market);
    }

    return null;
  }

  evaluateEntries(symbol, market) {
    let bestDecision = null;
    for (const [key, descriptor] of this.strategies.entries()) {
      const entryCheck = descriptor.instance.checkEntry(market);
      if (!entryCheck || entryCheck.enter !== true) continue;
      const bias = this.determineBias(key, market, entryCheck.meta);
      if (!bias) continue;

      const confidenceProfile = this.computeEntryConfidence(key, market, entryCheck.meta);
      if (!confidenceProfile) continue;

      const decision = {
        action: 'entry',
        symbol,
        bias,
        confidence: confidenceProfile.confidence,
        localConfidence: confidenceProfile.localConfidence,
        localEdge: confidenceProfile.localEdge,
        reasoning: `[${descriptor.label}] ${entryCheck.reason}`,
        model: `strategy-${key}`,
        source: `strategy:${key}`,
        entryPrice: market.current_price,
        strategyKey: key,
        strategyName: descriptor.label,
        meta: entryCheck.meta ?? {},
        entryMeta: {
          entryMove: toNumber(market.change_5m_pct),
        },
      };

      if (!bestDecision || decision.confidence > bestDecision.confidence) {
        bestDecision = decision;
      }
    }
    return bestDecision;
  }

  evaluateExit(symbol, market, position, managedMeta) {
    const descriptor = this.strategies.get(managedMeta.strategyKey);
    if (!descriptor) {
      return null;
    }

    const strategyPosition = {
      side: position.side,
      entryPrice: toNumber(position.entryPrice),
      entryMove: toNumber(managedMeta.entryMove),
    };

    const stop = descriptor.instance.checkStopLoss(strategyPosition, market);
    if (stop && stop.stop) {
      return this.buildExitDecision(symbol, position, managedMeta, stop.reason ?? 'stop-loss triggered', 'stop');
    }

    const exit = descriptor.instance.checkExit(strategyPosition, market);
    if (exit && exit.exit) {
      return this.buildExitDecision(symbol, position, managedMeta, exit.reason ?? 'exit signal', 'target');
    }

    return null;
  }

  buildExitDecision(symbol, position, managedMeta, reason, exitReason) {
    const exitOrderBias = position.side === 'long' ? 'short' : 'long';
    const confidence = exitReason === 'stop' ? 0.86 : 0.72;
    const localEdge = exitReason === 'stop' ? 0.74 : 0.6;
    const descriptor = this.strategies.get(managedMeta.strategyKey);
    const label = descriptor?.label ?? managedMeta.strategyKey ?? 'strategy';

    return {
      action: 'exit',
      symbol,
      bias: exitOrderBias,
      closeBias: position.side,
      confidence,
      localConfidence: Math.max(confidence, 0.68),
      localEdge,
      reasoning: `[${label}] ${reason}`,
      model: `strategy-${managedMeta.strategyKey}`,
      source: `strategy:${managedMeta.strategyKey}`,
      strategyKey: managedMeta.strategyKey,
      strategyName: label,
      exitReason,
    };
  }

  determineBias(key, market, meta = {}) {
    switch (key) {
      case 'momentum': {
        const move = toNumber(market.change_5m_pct);
        if (Math.abs(move) < 1e-4) return null;
        return move >= 0 ? 'long' : 'short';
      }
      case 'breakout':
        return 'long';
      case 'pullback': {
        const hint = typeof market.local_signal === 'string' ? market.local_signal.toLowerCase() : '';
        if (LOCAL_BEARISH_HINTS.has(hint)) return 'short';
        return 'long';
      }
      case 'gap': {
        const prevClose = toNumber(market.prev_close);
        const open = toNumber(market.open_price, market.current_price);
        if (!prevClose) return null;
        const gapPct = meta?.gapPct ?? ((open - prevClose) / prevClose) * 100;
        if (Math.abs(gapPct) < POSITION_EPSILON) return null;
        return gapPct >= 0 ? 'long' : 'short';
      }
      case 'range': {
        if (meta?.support) return 'long';
        if (meta?.resistance) return 'short';
        const support = toNumber(market.support);
        const resistance = toNumber(market.resistance);
        const price = toNumber(market.current_price);
        if (support && price <= support * 1.01) return 'long';
        if (resistance && price >= resistance * 0.99) return 'short';
        return null;
      }
      case 'price_action': {
        const pattern = typeof meta?.pattern === 'string' ? meta.pattern.toLowerCase() : market.local_pattern;
        if (!pattern) return null;
        if (BULLISH_PATTERNS.has(pattern)) return 'long';
        if (BEARISH_PATTERNS.has(pattern)) return 'short';
        return null;
      }
      default:
        return null;
    }
  }

  computeEntryConfidence(key, market, meta = {}) {
    const localConfidence = clamp(toNumber(market.local_signal_confidence, 0.58), 0.45, 0.95);
    switch (key) {
      case 'momentum': {
        const params = this.strategies.get(key)?.params ?? {};
        const move = Math.abs(toNumber(meta.move ?? market.change_5m_pct));
        const rv = toNumber(meta.rv ?? market.vol_ratio, 1);
        const edge = toNumber(meta.edge ?? market.edge_score, 0.45);
        const moveRatio = move / Math.max(params.minMovePct ?? 0.5, 0.1);
        const volRatio = rv / Math.max(params.minRelVol ?? 1.2, 0.1);
        const edgeRatio = edge / Math.max(params.minEdge ?? 0.5, 0.1);
        const composite = (moveRatio + volRatio + edgeRatio) / 3;
        const confidence = clamp(0.63 + 0.12 * Math.max(composite - 1, 0), 0.63, 0.94);
        const localEdge = clamp(0.48 + 0.18 * Math.max(edgeRatio - 1, 0), 0.48, 0.9);
        return {
          confidence,
          localEdge,
          localConfidence: Math.max(confidence, localConfidence),
        };
      }
      case 'breakout': {
        const params = this.strategies.get(key)?.params ?? {};
        const rel = toNumber(meta.rel ?? ((market.volume_24h && market.avg_volume_24h)
          ? market.volume_24h / Math.max(market.avg_volume_24h, 1)
          : 1), 1);
        const relRatio = rel / Math.max(params.volMultiplier ?? 1.5, 0.5);
        const score = relRatio + (meta.brokeHigh ? 0.5 : 0);
        const confidence = clamp(0.64 + 0.1 * Math.max(score - 1, 0), 0.64, 0.9);
        const localEdge = clamp(0.5 + 0.16 * Math.max(score - 1, 0), 0.5, 0.88);
        return {
          confidence,
          localEdge,
          localConfidence: Math.max(confidence, localConfidence),
        };
      }
      case 'pullback': {
        const price = toNumber(market.current_price);
        const ma = toNumber(market.ma);
        if (!ma) return null;
        const deviationPct = Math.abs((price - ma) / ma) * 100;
        const proximity = clamp(1 - deviationPct / 0.8, 0, 1);
        const hint = typeof market.local_signal === 'string' ? market.local_signal.toLowerCase() : '';
        const reversalBoost = LOCAL_BULLISH_HINTS.has(hint) ? 0.6 : LOCAL_BEARISH_HINTS.has(hint) ? 0.2 : 0.4;
        const score = (proximity * 0.6) + reversalBoost;
        const confidence = clamp(0.62 + 0.08 * score, 0.62, 0.88);
        const localEdge = clamp(0.48 + 0.12 * score, 0.48, 0.82);
        return {
          confidence,
          localEdge,
          localConfidence: Math.max(confidence, localConfidence),
        };
      }
      case 'gap': {
        const params = this.strategies.get(key)?.params ?? {};
        const prevClose = toNumber(market.prev_close);
        const open = toNumber(market.open_price, market.current_price);
        if (!prevClose) return null;
        const gapPct = Math.abs(meta.gapPct ?? ((open - prevClose) / prevClose) * 100);
        const ratio = gapPct / Math.max(params.minGapPct ?? 1, 0.2);
        const confidence = clamp(0.63 + 0.1 * Math.max(ratio - 1, 0), 0.63, 0.9);
        const localEdge = clamp(0.5 + 0.16 * Math.max(ratio - 1, 0), 0.5, 0.88);
        return {
          confidence,
          localEdge,
          localConfidence: Math.max(confidence, localConfidence),
        };
      }
      case 'range': {
        const price = toNumber(market.current_price);
        const support = toNumber(market.support);
        const resistance = toNumber(market.resistance);
        const distSupport = support ? Math.abs((price - support) / support) * 100 : Infinity;
        const distResistance = resistance ? Math.abs((resistance - price) / resistance) * 100 : Infinity;
        const boundaryDistance = Math.min(distSupport, distResistance);
        const proximity = clamp(1 - boundaryDistance / 1.1, 0, 1);
        const confidence = clamp(0.61 + 0.09 * proximity, 0.61, 0.86);
        const localEdge = clamp(0.48 + 0.12 * proximity, 0.48, 0.82);
        return {
          confidence,
          localEdge,
          localConfidence: Math.max(confidence, localConfidence),
        };
      }
      case 'price_action': {
        const pattern = typeof meta?.pattern === 'string' ? meta.pattern.toLowerCase() : market.local_pattern;
        if (!pattern) return null;
        const recognized = BULLISH_PATTERNS.has(pattern) || BEARISH_PATTERNS.has(pattern);
        if (!recognized) return null;
        const confidence = clamp(0.7, 0.64, 0.85);
        const localEdge = clamp(0.6, 0.5, 0.82);
        return {
          confidence,
          localEdge,
          localConfidence: Math.max(confidence, localConfidence),
        };
      }
      default:
        return null;
    }
  }

  notifyExecution(decision, result) {
    if (!decision || decision.action !== 'entry' || !decision.strategyKey) {
      return;
    }
    const entryMeta = {
      strategyKey: decision.strategyKey,
      strategyName: decision.strategyName,
      entryMove: toNumber(decision.entryMeta?.entryMove),
      entryTime: Date.now(),
      size: toNumber(result?.executedQty, 0),
      source: decision.source ?? `strategy:${decision.strategyKey}`,
    };
    this.activePositions.set(decision.symbol, entryMeta);
  }

  notifyExit(decision) {
    if (!decision || decision.action !== 'exit') {
      return;
    }
    this.activePositions.delete(decision.symbol);
  }

  getPositionMeta(symbol) {
    return this.activePositions.get(symbol) ?? null;
  }

  clearPosition(symbol) {
    this.activePositions.delete(symbol);
  }
}
