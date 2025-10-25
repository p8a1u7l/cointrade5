import { BinanceClient, BinanceRealtimeFeed } from '../clients/binanceClient.js';
import { requestStrategy } from '../clients/openaiClient.js';
import { AnalyticsRecorder } from '../clients/analyticsRecorder.js';
import { config } from '../config.js';
import { analyticsStore } from '../store/analyticsStore.js';
import { logger } from '../utils/logger.js';
import { TypedEventEmitter } from '../utils/eventEmitter.js';
import { StrategyTradeAdapter } from '../strategies/StrategyAdapter.js';
import { fetchEquitySnapshot } from './equitySnapshot.js';
import { getMarketSnapshot } from './marketIntelligence.js';

const RISK_LEVERAGE = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: config.trading.maxPositionLeverage,
};

const BASE_ORDER_NOTIONAL = 40;
const DEFAULT_CONFIDENCE_GUESS = 0.75;
const MARGIN_USAGE_BUFFER = 0.9;

const CONTEXT_SHIFT_THRESHOLD = 0.12;
const MIN_CONFIDENCE_TO_EXECUTE = 0.62;
const MIN_LOCAL_EDGE = 0.4;
const MIN_LOCAL_CONFIDENCE = 0.55;
const POSITION_EPSILON = 1e-8;

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

function computeContextShift(previous, next) {
  if (!previous || !next) {
    return 0;
  }

  const prevBias = previous?.local_signal?.bias;
  const nextBias = next?.local_signal?.bias;
  if (prevBias && nextBias && prevBias !== nextBias) {
    return Infinity;
  }

  const fields = [
    ['change_5m_pct', 6],
    ['change_15m_pct', 10],
    ['rsi_14', 100],
    ['vol_ratio', 5],
    ['edge_score', 1],
    ['atr_pct', 5],
  ];

  let maxShift = 0;
  for (const [key, scale] of fields) {
    const previousValue = toNumber(previous[key]);
    const nextValue = toNumber(next[key]);
    if (!Number.isFinite(previousValue) || !Number.isFinite(nextValue)) {
      continue;
    }
    const normalized = Math.abs(nextValue - previousValue) / scale;
    if (normalized > maxShift) {
      maxShift = normalized;
    }
  }

  const prevConfidence = toNumber(previous?.local_signal?.confidence);
  const nextConfidence = toNumber(next?.local_signal?.confidence);
  if (Number.isFinite(prevConfidence) && Number.isFinite(nextConfidence)) {
    maxShift = Math.max(maxShift, Math.abs(nextConfidence - prevConfidence));
  }

  return maxShift;
}

export class TradingEngine extends TypedEventEmitter {
  constructor(symbols) {
    super();
    this.baseSymbols = Array.from(new Set(Array.isArray(symbols) ? symbols.map((s) => s.toUpperCase()) : []));
    this.activeSymbols = [...this.baseSymbols];
    this.cachedTopMovers = [];
    this.lastSymbolRefresh = 0;
    this.riskLevel = 3;
    this.running = false;
    this.loopTimer = undefined;
    this.binance = new BinanceClient();
    this.recorder = new AnalyticsRecorder();
    this.stream = new BinanceRealtimeFeed();
    this.latestTicks = new Map();
    this.decisionCache = new Map();
    this.strategyAdapter = new StrategyTradeAdapter({ logger });
    this.positionCache = { timestamp: 0, map: new Map() };
    this.balanceCache = { timestamp: 0, available: 0 };
    this.loopInFlight = false;
    this.aiCooldownMs = 45_000;
    this.aiRevalidationMs = 240_000;
    this.baseSymbolsValidated = false;

    this.stream.on('tick', (tick) => {
      this.latestTicks.set(tick.symbol, tick);
      this.emit('tick', tick);
    });
  }

  getActiveSymbols() {
    return [...this.activeSymbols];
  }

  getTopMovers() {
    return [...this.cachedTopMovers];
  }

  invalidatePositionCache() {
    this.positionCache = { timestamp: 0, map: new Map() };
  }

  invalidateBalanceCache() {
    this.balanceCache = { timestamp: 0, available: 0 };
  }

  async getPosition(symbol, options = {}) {
    const now = Date.now();
    const ttl = Number.isFinite(options.ttl) ? Number(options.ttl) : 3_000;
    const useCache = !options.forceRefresh && this.positionCache?.map && now - this.positionCache.timestamp < ttl;

    if (!useCache) {
      try {
        const positions = await this.binance.fetchPositions();
        const map = new Map();
        for (const rawPosition of positions ?? []) {
          map.set(rawPosition.symbol, rawPosition);
        }
        this.positionCache = { timestamp: now, map };
      } catch (error) {
        logger.error({ error, symbol }, 'Failed to refresh Binance positions');
        return null;
      }
    }

    const raw = this.positionCache.map.get(symbol);
    return this.projectPosition(symbol, raw);
  }

  projectPosition(symbol, raw) {
    if (!raw || !Number.isFinite(raw.positionAmt) || Math.abs(raw.positionAmt) < POSITION_EPSILON) {
      if (this.strategyAdapter?.getPositionMeta(symbol)) {
        this.strategyAdapter.clearPosition(symbol);
      }
      return null;
    }

    const side = raw.positionAmt > 0 ? 'long' : 'short';
    const quantity = Math.abs(raw.positionAmt);
    const entryPrice = toNumber(raw.entryPrice);
    const meta = this.strategyAdapter?.getPositionMeta(symbol);

    return {
      symbol,
      side,
      quantity,
      entryPrice,
      entryMove: meta?.entryMove,
      strategyKey: meta?.strategyKey,
      strategyName: meta?.strategyName,
      entryTime: meta?.entryTime,
      raw,
    };
  }

  async getAvailableMargin(options = {}) {
    const now = Date.now();
    const ttl = Number.isFinite(options.ttl) ? Number(options.ttl) : 3_000;
    if (!options.forceRefresh && now - this.balanceCache.timestamp < ttl && Number.isFinite(this.balanceCache.available)) {
      return this.balanceCache.available;
    }

    try {
      const balances = await this.binance.fetchAccountBalance();
      const usdt = balances.find((entry) => entry.asset === 'USDT');
      const available = Number(usdt?.available ?? usdt?.balance ?? 0);
      if (!Number.isFinite(available)) {
        throw new Error('Invalid available balance for USDT');
      }
      this.balanceCache = { timestamp: now, available };
      return available;
    } catch (error) {
      logger.error({ error }, 'Failed to refresh available Binance margin');
      this.balanceCache = { timestamp: now, available: 0 };
      return 0;
    }
  }

  async refreshSymbolUniverse(options = {}) {
    const discovery = config.binance.symbolDiscovery ?? {};
    const enabled = discovery.enabled !== false;
    if (!this.baseSymbolsValidated) {
      try {
        const validated = await this.binance.filterTradableSymbols(this.baseSymbols, discovery.quoteAssets);
        if (validated.length > 0) {
          this.baseSymbols = validated;
          this.activeSymbols = [...validated];
          this.baseSymbolsValidated = true;
        }
      } catch (error) {
        logger.error({ error }, 'Failed to validate base Binance symbols');
      }
    }
    if (!enabled) {
      this._updateActiveSymbols(this.baseSymbols);
      return { symbols: this.getActiveSymbols(), movers: [] };
    }

    const now = Date.now();
    const intervalMs = Math.max(30_000, Number(discovery.refreshIntervalSeconds ?? 180) * 1000);
    const force = options.force === true;
    if (!force && now - this.lastSymbolRefresh < intervalMs) {
      return { symbols: this.getActiveSymbols(), movers: this.getTopMovers() };
    }

    const configuredMax = Math.max(Number(discovery.maxActiveSymbols ?? 0), this.baseSymbols.length);
    const dynamicBudget = Math.max(configuredMax - this.baseSymbols.length, 0);
    const fetchLimit = Math.max(
      Number(discovery.topMoverLimit ?? 0),
      dynamicBudget > 0 ? dynamicBudget : 0,
      20
    );

    try {
      const movers = await this.binance.fetchTopMovers({
        limit: fetchLimit,
        minQuoteVolume: discovery.minQuoteVolume,
        quoteAssets: discovery.quoteAssets,
      });
      this.cachedTopMovers = movers;
      this.lastSymbolRefresh = now;

      const baseSet = new Set(this.baseSymbols);
      const dynamicCandidates = movers
        .map((item) => item.symbol)
        .filter((symbol) => !baseSet.has(symbol));
      const limitedDynamics = dynamicBudget > 0
        ? dynamicCandidates.slice(0, dynamicBudget)
        : dynamicCandidates;

      const nextSymbols = [...this.baseSymbols, ...limitedDynamics];
      const tradable = await this.binance.filterTradableSymbols(nextSymbols, discovery.quoteAssets);
      if (tradable.length === 0) {
        logger.warn('Binance symbol scan returned no tradable instruments, falling back to base set');
      }
      const candidate = tradable.length > 0 ? tradable : this.baseSymbols;
      const changed = this._updateActiveSymbols(candidate);

      if (changed) {
        logger.info(
          {
            base: this.baseSymbols.length,
            dynamic: Math.max(candidate.length - this.baseSymbols.length, 0),
            total: candidate.length,
          },
          'Updated active symbol universe from Binance movers scan'
        );
      }

      return { symbols: this.getActiveSymbols(), movers };
    } catch (error) {
      logger.error({ error }, 'Failed to refresh symbol universe');
      if (force && this.activeSymbols.length === 0 && this.baseSymbols.length > 0) {
        this._updateActiveSymbols(this.baseSymbols);
      }
      return { symbols: this.getActiveSymbols(), movers: this.getTopMovers() };
    }
  }

  _updateActiveSymbols(nextSymbols) {
    const unique = Array.from(new Set((nextSymbols ?? []).map((symbol) => symbol.toUpperCase())));
    const changed =
      unique.length !== this.activeSymbols.length ||
      unique.some((symbol, index) => symbol !== this.activeSymbols[index]);
    if (!changed) {
      return false;
    }

    this.activeSymbols = unique;
    const activeSet = new Set(this.activeSymbols);
    for (const key of Array.from(this.latestTicks.keys())) {
      if (!activeSet.has(key)) {
        this.latestTicks.delete(key);
      }
    }
    for (const key of Array.from(this.decisionCache.keys())) {
      if (!activeSet.has(key)) {
        this.decisionCache.delete(key);
      }
    }
    if (this.running) {
      this.stream.start(this.activeSymbols);
    }
    this.emit('symbolsChanged', this.getActiveSymbols());
    return true;
  }

  getRiskLevel() {
    return this.riskLevel;
  }

  isRunning() {
    return this.running;
  }

  setRiskLevel(level) {
    if (this.riskLevel === level) return;
    this.riskLevel = level;
    this.emit('riskChanged', level);
  }

  async start() {
    if (this.running) return;
    await this.refreshSymbolUniverse({ force: true });
    if (this.activeSymbols.length === 0) {
      throw new Error('No Binance symbols available to trade');
    }
    this.stream.start(this.activeSymbols);
    try {
      await this.captureEquitySnapshot({ requireSuccess: true });
      this.running = true;
      this.scheduleNextLoop(0);
      this.emit('started');
      logger.info({ symbols: this.getActiveSymbols() }, 'Trading engine started');
    } catch (error) {
      this.stream.stop();
      throw error;
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = undefined;
    }
    this.stream.stop();
    this.emit('stopped');
    logger.info('Trading engine stopped');
  }

  scheduleNextLoop(delayMs) {
    if (!this.running) return;
    const timeout = delayMs ?? config.trading.loopIntervalSeconds * 1000;
    this.loopTimer = setTimeout(() => {
      this.executeLoop().catch(this.handleLoopError);
    }, timeout);
  }

  handleLoopError = (error) => {
    logger.error({ error }, 'Trading loop encountered an error');
    this.scheduleNextLoop();
  };

  async runOnce() {
    await this.executeLoop();
  }

  async executeLoop() {
    if (this.loopInFlight) {
      logger.warn('Loop already in flight, skipping runOnce invocation');
      return;
    }
    if (!this.running) return;
    this.loopInFlight = true;
    try {
      await this.refreshSymbolUniverse();
      const symbols = this.getActiveSymbols();
      if (symbols.length === 0) {
        logger.warn('No active symbols available, skipping evaluation loop');
        await this.captureEquitySnapshot();
        return;
      }
      for (const symbol of symbols) {
        try {
          const decision = await this.evaluateSymbol(symbol);
          await this.executeDecision(decision);
        } catch (error) {
          logger.error({ error, symbol }, 'Failed to execute trading decision');
        }
      }
      await this.captureEquitySnapshot();
    } finally {
      this.loopInFlight = false;
    }
    this.scheduleNextLoop();
  }

  async evaluateSymbol(symbol) {
    const tick = this.latestTicks.get(symbol);
    let snapshot;
    try {
      snapshot = await getMarketSnapshot(this.binance, symbol, {
        interval: '1m',
        limit: 150,
      });
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to build market snapshot');
      const cached = this.decisionCache.get(symbol);
      if (cached) {
        const { usage: _usage, ...rest } = cached.decision;
        const fallback = {
          ...rest,
          reasoning: `${rest.reasoning} · Snapshot unavailable, maintaining prior stance`,
        };
        await this.recorder.recordStrategy(fallback, this.riskLevel);
        return fallback;
      }
      throw error;
    }

    let contextSnapshot = null;
    if (typeof snapshot.promptContext === 'string' && snapshot.promptContext.length > 0) {
      try {
        contextSnapshot = JSON.parse(snapshot.promptContext);
      } catch (error) {
        logger.debug({ error, symbol }, 'Unable to parse prompt context for strategy evaluation');
      }
    }

    const position = await this.getPosition(symbol);
    const priceReference = Number(snapshot?.metrics?.lastPrice);
    const normalizedPrice = Number.isFinite(priceReference) && priceReference > 0 ? priceReference : undefined;

    if (this.strategyAdapter) {
      const localDecision = this.strategyAdapter.evaluate(symbol, snapshot, position);
      if (localDecision) {
        const directEntry = Number(localDecision.entryPrice);
        const entryPrice = Number.isFinite(directEntry) && directEntry > 0 ? directEntry : normalizedPrice;
        const enrichedLocalDecision = {
          ...localDecision,
          entryPrice,
        };

        const cachePrice = Number.isFinite(entryPrice) ? entryPrice : normalizedPrice ?? null;

        this.decisionCache.set(symbol, {
          decision: enrichedLocalDecision,
          price: cachePrice,
          timestamp: Date.now(),
          source: 'strategy',
          contextSnapshot,
          model: enrichedLocalDecision.model ?? `strategy:${enrichedLocalDecision.strategyKey ?? 'local'}`,
        });

        await this.recorder.recordStrategy(enrichedLocalDecision, this.riskLevel);
        return enrichedLocalDecision;
      }
    }

    const decision = await this.resolveDecision(symbol, snapshot, tick, contextSnapshot);
    await this.recorder.recordStrategy(decision, this.riskLevel);
    return decision;
  }

  async resolveDecision(symbol, snapshot, tick, contextSnapshot) {
    const round = (value, digits = 2) => {
      if (!Number.isFinite(value)) return 0;
      return Number(value.toFixed(digits));
    };

    const clampConfidence = (value, fallback = 0) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return Math.max(0, Math.min(1, fallback));
      }
      return Math.max(0, Math.min(1, numeric));
    };

    const safeRound = (value, digits = 2) => {
      if (!Number.isFinite(value)) {
        return undefined;
      }
      return round(value, digits);
    };

    const trimReasoning = (text, wordLimit = 18) => {
      if (typeof text !== 'string') {
        return undefined;
      }
      const words = text.trim().split(/\s+/);
      if (words.length <= wordLimit) {
        return words.join(' ');
      }
      return `${words.slice(0, wordLimit).join(' ')}...`;
    };

    const condensePromptContext = (context, emphasiseLocal) => {
      if (!context || typeof context !== 'object') {
        return null;
      }

      const local = context.local_signal ?? {};
      const localSummary = {
        bias: local.bias ?? null,
        confidence: Number.isFinite(local.confidence) ? round(local.confidence, 2) : undefined,
        edge: Number.isFinite(local.edgeScore) ? round(local.edgeScore, 2) : undefined,
        reasoning: trimReasoning(local.reasoning, emphasiseLocal ? 12 : 18),
      };

      const base = {
        symbol: context.symbol,
        price: safeRound(context.price, 2),
        change_1m_pct: safeRound(context.change_1m_pct, 2),
        change_5m_pct: safeRound(context.change_5m_pct, 2),
        change_15m_pct: safeRound(context.change_15m_pct, 2),
        rsi_14: safeRound(context.rsi_14, 2),
        vol_ratio: safeRound(context.vol_ratio, 2),
        atr_pct: safeRound(context.atr_pct, 3),
        edge_score: safeRound(context.edge_score, 2),
        local_signal: localSummary,
      };

      if (!emphasiseLocal) {
        base.volatility_pct = safeRound(context.volatility_pct, 3);
        base.vol_change_pct = safeRound(context.vol_change_pct, 2);
        base.vol_accel_pct = safeRound(context.vol_accel_pct, 2);
        base.mfi_14 = safeRound(context.mfi_14, 2);
        base.obv_slope_pct = safeRound(context.obv_slope_pct, 2);
        base.support = safeRound(context.support, 2);
        base.resistance = safeRound(context.resistance, 2);
      }

      if (context.ticker_24h && typeof context.ticker_24h === 'object') {
        base.ticker_24h = {
          change_pct: safeRound(context.ticker_24h.change_pct, 2),
          high: safeRound(context.ticker_24h.high, 2),
          low: safeRound(context.ticker_24h.low, 2),
        };
      }

      if (context.derivatives && typeof context.derivatives === 'object') {
        base.derivatives = {
          funding_rate: safeRound(context.derivatives.funding_rate, 4),
          mark_price: safeRound(context.derivatives.mark_price, 2),
          index_price: safeRound(context.derivatives.index_price, 2),
        };
      }

      if (context.open_interest && typeof context.open_interest === 'object') {
        base.open_interest = {
          contracts: safeRound(context.open_interest.contracts, 2),
        };
      }

      if (context.taker_flow && typeof context.taker_flow === 'object') {
        base.taker_flow = {
          ratio: safeRound(context.taker_flow.ratio, 3),
          bias: context.taker_flow.bias,
        };
      }

      return JSON.stringify(base);
    };

    const priceReference = snapshot.metrics.lastPrice;
    const localSignal = snapshot.metrics.localSignal;
    const localEdge = Number.isFinite(localSignal?.edgeScore) ? localSignal.edgeScore : 0;
    const localConfidence = clampConfidence(localSignal?.confidence, 0);
    let promptSnapshot = contextSnapshot ?? null;
    if (!promptSnapshot && typeof snapshot.promptContext === 'string' && snapshot.promptContext.length > 0) {
      try {
        promptSnapshot = JSON.parse(snapshot.promptContext);
      } catch (error) {
        logger.warn({ error, symbol }, 'Failed to parse prompt context for cache heuristics');
      }
    }
    const now = Date.now();
    const cached = this.decisionCache.get(symbol);
    const priceDrift = cached?.price
      ? Math.abs((priceReference - cached.price) / cached.price)
      : Infinity;
    const ageMs = cached ? now - cached.timestamp : Infinity;

    const strongLocalSignal =
      localSignal.bias !== 'flat' &&
      ((localSignal.confidence >= 0.68 && localEdge >= 0.48) || localSignal.confidence >= 0.82 || localEdge >= 0.62);

    const contextForAi =
      condensePromptContext(promptSnapshot, strongLocalSignal) ?? snapshot.promptContext;

    const previousContext = cached?.contextSnapshot;
    const hasContextSnapshots = Boolean(previousContext && promptSnapshot);
    const contextShift = hasContextSnapshots ? computeContextShift(previousContext, promptSnapshot) : 0;
    const contextStable = hasContextSnapshots
      ? Number.isFinite(contextShift) && contextShift < CONTEXT_SHIFT_THRESHOLD
      : true;
    const localBiasChanged =
      hasContextSnapshots &&
      previousContext?.local_signal?.bias &&
      promptSnapshot?.local_signal?.bias &&
      previousContext.local_signal.bias !== promptSnapshot.local_signal.bias;

    const stalePrice = !Number.isFinite(priceDrift) || priceDrift >= 0.0012;
    const staleTime = ageMs >= this.aiRevalidationMs;

    let reuseReason;
    if (cached && cached.source === 'openai' && contextStable && !localBiasChanged) {
      if (!stalePrice && !staleTime) {
        reuseReason = 'Maintaining stance';
      } else if (ageMs < this.aiCooldownMs && priceDrift < 0.0025) {
        reuseReason = 'Cooldown reuse';
      }
    }

    if (reuseReason && cached) {
      const driftPct = priceDrift * 100;
      const contextShiftValue = Number.isFinite(contextShift) ? Number(contextShift.toFixed(3)) : null;
      const { usage: _usage, ...rest } = cached.decision;
      const reused = {
        ...rest,
        reasoning: `${rest.reasoning} · ${reuseReason} (price drift ${round(driftPct, 3)}%)`,
        localEdge,
        localConfidence,
        localBias: localSignal.bias,
        entryPrice: priceReference,
        confidence: clampConfidence(rest.confidence, localConfidence),
      };
      this.decisionCache.set(symbol, {
        ...cached,
        decision: reused,
        price: priceReference,
        timestamp: now,
        contextSnapshot: promptSnapshot ?? cached.contextSnapshot ?? null,
      });
      logger.debug({ symbol, driftPct: round(driftPct, 3), contextShift: contextShiftValue }, 'Reusing cached OpenAI decision');
      return reused;
    }

    const leveragePreset = RISK_LEVERAGE[this.riskLevel] ?? 1;
    const estimatedNotional = BASE_ORDER_NOTIONAL * Math.max(leveragePreset, 1) * DEFAULT_CONFIDENCE_GUESS;
    const llmDecision = await requestStrategy(symbol, contextForAi, {
      riskLevel: this.riskLevel,
      leverage: leveragePreset,
      estimatedNotional,
    });
    const enhanced = {
      ...llmDecision,
      bias: llmDecision.bias ?? localSignal.bias,
      confidence: clampConfidence(llmDecision.confidence, localConfidence || 0.5),
      reasoning: `${llmDecision.reasoning} · ?5m ${round(snapshot.metrics.change5mPct, 2)}%, RSI ${round(
        snapshot.metrics.rsi14,
        1
      )} · Vol ${round(snapshot.metrics.volumeRatio, 2)} · MFI ${round(snapshot.metrics.mfi14, 1)}`,
      localEdge,
      localConfidence,
      localBias: localSignal.bias,
      entryPrice: priceReference,
      promptContextSize: typeof contextForAi === 'string' ? contextForAi.length : undefined,
    };
    if (!enhanced.action) {
      enhanced.action = 'entry';
    }

    if (strongLocalSignal) {
      const localSnippet = trimReasoning(localSignal.reasoning, 12);
      const edgePercent = Number.isFinite(localEdge) ? Math.round(localEdge * 100) : undefined;
      const localAnnotationParts = [];
      if (localSnippet) {
        localAnnotationParts.push(localSnippet);
      }
      if (edgePercent !== undefined) {
        localAnnotationParts.push(`edge ${edgePercent}%`);
      }
      localAnnotationParts.push(`confidence ${Math.round(localConfidence * 100)}%`);
      enhanced.reasoning = `${enhanced.reasoning} · Local confirms: ${localAnnotationParts.join(' · ')}`;
      enhanced.confidence = clampConfidence(Math.max(enhanced.confidence, localConfidence));
    }

    if (tick) {
      enhanced.marketTime = new Date(tick.eventTime).toISOString();
    }

    this.decisionCache.set(symbol, {
      decision: enhanced,
      price: priceReference,
      timestamp: now,
      source: 'openai',
      contextSnapshot: promptSnapshot ?? null,
      model: enhanced.model ?? llmDecision.model ?? 'openai',
    });
    return enhanced;
  }

  async executeDecision(decision) {
    if (!decision) {
      logger.info({ decision }, 'Skipping execution due to empty decision');
      return;
    }

    if (decision.action === 'exit') {
      await this.executeExit(decision);
      return;
    }

    if (decision.bias === 'flat') {
      logger.info({ decision }, 'Skipping execution due to neutral signal');
      return;
    }

    if (!this.hasStrongConviction(decision)) {
      logger.info({ decision }, 'Skipping execution due to insufficient conviction');
      return;
    }

    const leverage = RISK_LEVERAGE[this.riskLevel];
    const side = decision.bias === 'long' ? 'BUY' : 'SELL';
    const confidence = Number(decision.confidence ?? 0);

    let referencePrice = Number(decision.entryPrice);
    if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
      const tick = this.latestTicks.get(decision.symbol);
      if (tick && Number.isFinite(tick.price) && tick.price > 0) {
        referencePrice = tick.price;
      }
    }

    const rawQuantity = this.calculateOrderSize(decision.symbol, leverage, confidence, referencePrice);
    let normalized = await this.binance.ensureTradableQuantity(decision.symbol, rawQuantity, referencePrice);
    let quantity = normalized?.quantity ?? 0;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      logger.warn({ decision, referencePrice, rawQuantity, normalized }, 'Normalized order size invalid, skipping execution');
      return;
    }

    const marginCheck = await this.enforceMarginLimit(decision.symbol, leverage, referencePrice, normalized, rawQuantity);
    if (!marginCheck.allowed) {
      logger.warn({ decision, referencePrice, rawQuantity, normalized }, 'Skipping execution due to margin constraints');
      return;
    }

    if (marginCheck.normalized) {
      normalized = marginCheck.normalized;
      quantity = normalized?.quantity ?? quantity;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      logger.warn({ decision, referencePrice, rawQuantity, normalized }, 'Margin-adjusted quantity invalid, skipping execution');
      return;
    }

    if (Math.abs(quantity - rawQuantity) > Math.max(1e-8, rawQuantity * 0.05)) {
      logger.debug({ decision, rawQuantity, quantity }, 'Adjusted quantity after filters/margin checks');
    }

    await this.binance.setLeverage(decision.symbol, leverage);
    const quantityParam = normalized?.quantityText ?? quantity;
    let result;
    try {
      result = await this.binance.placeMarketOrder(decision.symbol, side, quantityParam);
    } catch (error) {
      this.invalidateBalanceCache();
      if (error instanceof Error && /margin is insufficient/i.test(error.message)) {
        logger.error({ decision, error }, 'Binance rejected order due to insufficient margin after guard');
        return;
      }
      throw error;
    }
    await this.recorder.recordExecution(
      {
        symbol: decision.symbol,
        orderId: String(result.orderId),
        status: result.status,
        filledQty: result.executedQty,
        avgPrice: result.avgPrice,
      },
      decision
    );
    this.strategyAdapter?.notifyExecution(decision, result);
    this.invalidatePositionCache();
    this.invalidateBalanceCache();
    logger.info({ decision, result }, 'Executed market order');
  }

  async executeExit(decision) {
    if (!decision?.symbol) {
      logger.warn({ decision }, 'Cannot execute exit without symbol');
      return;
    }

    const position = await this.getPosition(decision.symbol, { forceRefresh: true });
    if (!position) {
      logger.info({ decision }, 'Skipping exit because no active position was found');
      return;
    }

    if (decision.closeBias && decision.closeBias !== position.side) {
      logger.debug({ decision, position }, 'Exit bias differs from live position side');
    }

    const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
    const quantity = Math.abs(position.quantity);
    if (!Number.isFinite(quantity) || quantity <= POSITION_EPSILON) {
      logger.info({ decision, position }, 'Skipping exit due to negligible position size');
      return;
    }

    const result = await this.binance.placeMarketOrder(decision.symbol, orderSide, quantity);
    const recorderDecision = {
      ...decision,
      bias: orderSide === 'BUY' ? 'long' : 'short',
    };
    await this.recorder.recordExecution(
      {
        symbol: decision.symbol,
        orderId: String(result.orderId),
        status: result.status,
        filledQty: result.executedQty,
        avgPrice: result.avgPrice,
      },
      recorderDecision
    );
    this.strategyAdapter?.notifyExit(decision, result);
    this.invalidatePositionCache();
    this.invalidateBalanceCache();
    logger.info({ decision, result }, 'Closed position via strategy exit');
  }

  calculateOrderSize(symbol, leverage, confidence, referencePrice) {
    const safeConfidence = Number.isFinite(confidence) ? Math.max(confidence, 0.1) : 0.1;
    const targetNotional = BASE_ORDER_NOTIONAL * Math.max(leverage, 1) * safeConfidence;
    if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
      const fallbackQty = Number((targetNotional / 1000).toFixed(6));
      logger.debug({ symbol, fallbackQty }, 'Calculated fallback order size without reference price');
      return fallbackQty;
    }
    const quantity = targetNotional / referencePrice;
    logger.debug({ symbol, quantity, referencePrice, targetNotional }, 'Calculated order size');
    return Number(quantity.toFixed(6));
  }

  async enforceMarginLimit(symbol, leverage, referencePrice, normalized, rawQuantity) {
    const quantity = normalized?.quantity ?? 0;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { allowed: false, normalized };
    }

    if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
      return { allowed: true, normalized };
    }

    const available = await this.getAvailableMargin();
    if (!Number.isFinite(available) || available <= 0) {
      logger.warn({ symbol }, 'Insufficient available margin to open new position');
      return { allowed: false, normalized };
    }

    const effectiveLeverage = Math.max(leverage, 1);
    const maxNotional = available * effectiveLeverage * MARGIN_USAGE_BUFFER;
    if (!Number.isFinite(maxNotional) || maxNotional <= 0) {
      logger.warn({ symbol, available, leverage: effectiveLeverage }, 'Invalid margin ceiling computed for position sizing');
      return { allowed: false, normalized };
    }

    const desiredNotional = quantity * referencePrice;
    if (desiredNotional <= maxNotional) {
      return { allowed: true, normalized };
    }

    const minNotional = normalized?.filters?.minNotional ?? 0;
    if (maxNotional > 0 && maxNotional < minNotional) {
      logger.warn({ symbol, desiredNotional, maxNotional, minNotional }, 'Margin cap below Binance minimum notional');
      return { allowed: false, normalized: { quantity: 0, quantityText: undefined, filters: normalized?.filters } };
    }

    const cappedQty = maxNotional / referencePrice;
    const adjusted = await this.binance.ensureTradableQuantity(symbol, cappedQty, referencePrice);
    const adjustedQty = adjusted?.quantity ?? 0;
    if (!Number.isFinite(adjustedQty) || adjustedQty <= 0) {
      logger.warn({ symbol, desiredNotional, maxNotional, cappedQty }, 'Unable to adjust quantity within margin constraints');
      return { allowed: false, normalized: adjusted ?? normalized };
    }

    const adjustedNotional = adjustedQty * referencePrice;
    logger.info({
      symbol,
      desiredNotional,
      adjustedNotional,
      available,
      leverage: effectiveLeverage,
      rawQuantity,
      adjustedQuantity: adjustedQty,
    }, 'Reduced order size to respect available margin');

    return { allowed: true, normalized: adjusted };
  }

  hasStrongConviction(decision) {
    const confidence = Number(decision?.confidence ?? 0);
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE_TO_EXECUTE) {
      return false;
    }

    const localEdge = Number(decision?.localEdge ?? decision?.edgeScore ?? 0);
    if (!Number.isFinite(localEdge) || localEdge < MIN_LOCAL_EDGE) {
      return false;
    }

    const localConfidence = Number(decision?.localConfidence ?? 0);
    if (Number.isFinite(localConfidence) && localConfidence < MIN_LOCAL_CONFIDENCE) {
      return false;
    }

    return true;
  }

  async captureEquitySnapshot(options = {}) {
    try {
      const baseline = analyticsStore.getBaselineEquity();
      const snapshot = await fetchEquitySnapshot(this.binance, baseline);
      await this.recorder.recordEquity(snapshot);
    } catch (error) {
      logger.error({ error }, 'Failed to capture equity snapshot');
      if (options?.requireSuccess) {
        throw error;
      }
    }
  }
}
