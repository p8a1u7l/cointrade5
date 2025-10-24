import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { TypedEventEmitter } from '../utils/eventEmitter.js';

const REST_BASE_URL = config.binance.useTestnet
  ? 'https://testnet.binancefuture.com'
  : 'https://fapi.binance.com';
const EXCHANGE_INFO_TTL_MS = 5 * 60 * 1000;

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const positiveOrInfinity = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return numeric;
};

const parsePrecision = (raw) => {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const [, fractional] = raw.split('.');
  if (!fractional) {
    return 0;
  }
  const trimmed = fractional.replace(/0+$/, '');
  return trimmed.length;
};

const buildFiltersFromExchangeInfo = (info) => {
  if (!info) {
    return {
      stepSize: 0,
      minQty: 0,
      maxQty: Number.POSITIVE_INFINITY,
      minNotional: 0,
      maxNotional: Number.POSITIVE_INFINITY,
      quantityPrecision: undefined,
      stepSizePrecision: undefined,
    };
  }

  const filters = Array.isArray(info.filters) ? info.filters : [];
  const findFilter = (type) => filters.find((filter) => filter?.filterType === type) ?? null;

  const lotFilter = findFilter('LOT_SIZE');
  const marketLotFilter = findFilter('MARKET_LOT_SIZE');
  const effectiveLotFilter = marketLotFilter ?? lotFilter ?? null;
  const notionalFilter = findFilter('NOTIONAL') ?? findFilter('MIN_NOTIONAL') ?? null;

  const stepSize = toFiniteNumber(effectiveLotFilter?.stepSize ?? lotFilter?.stepSize, 0);
  const minQty = Math.max(
    toFiniteNumber(marketLotFilter?.minQty, 0),
    toFiniteNumber(lotFilter?.minQty, 0),
    0,
  );
  const maxQty = Math.min(
    positiveOrInfinity(marketLotFilter?.maxQty),
    positiveOrInfinity(lotFilter?.maxQty),
  );

  const quantityPrecision = Number.isFinite(Number(info.quantityPrecision))
    ? Math.max(0, Math.floor(Number(info.quantityPrecision)))
    : undefined;
  const stepSizePrecision = parsePrecision(effectiveLotFilter?.stepSize ?? lotFilter?.stepSize);

  return {
    stepSize,
    minQty,
    maxQty: Number.isFinite(maxQty) ? maxQty : Number.POSITIVE_INFINITY,
    minNotional: toFiniteNumber(notionalFilter?.minNotional ?? notionalFilter?.notional, 0),
    maxNotional: positiveOrInfinity(notionalFilter?.maxNotional),
    quantityPrecision,
    stepSizePrecision,
  };
};

const normalizeQuoteAssetFilter = (quoteAssets) => {
  if (!quoteAssets) {
    return null;
  }

  const source = quoteAssets instanceof Set
    ? [...quoteAssets]
    : Array.isArray(quoteAssets)
      ? quoteAssets
      : [quoteAssets];

  const normalized = new Set();
  for (const entry of source) {
    if (entry === undefined || entry === null) {
      continue;
    }
    const value = String(entry).trim().toUpperCase();
    if (value.length > 0) {
      normalized.add(value);
    }
  }

  return normalized.size > 0 ? normalized : null;
};

export class BinanceRealtimeFeed extends TypedEventEmitter {
  constructor() {
    super();
    this.pollTimer = undefined;
    this.symbols = [];
  }

  start(symbols) {
    this.stop();
    this.symbols = Array.from(new Set(Array.isArray(symbols) ? symbols : []));
    if (this.symbols.length === 0) {
      return;
    }
    const poll = () => {
      void this._pollPrices(this.symbols);
    };
    poll();
    this.pollTimer = setInterval(poll, 1000);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.symbols = [];
  }

  async _pollPrices(symbols) {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return;
    }

    if (symbols.length > 40) {
      await this._pollBulkPrices(symbols);
      return;
    }

    for (const symbol of symbols) {
      try {
        const response = await fetch(
          `${REST_BASE_URL}/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`
        );
        if (!response.ok) {
          throw new Error(`Binance price request failed: ${response.status}`);
        }
        const payload = await response.json();
        const price = Number(payload.price);
        if (Number.isNaN(price)) {
          throw new Error('Received invalid price from Binance');
        }
        this.emit('tick', {
          symbol: payload.symbol ?? symbol,
          price,
          eventTime: Date.now(),
        });
      } catch (error) {
        logger.error({ error, symbol }, 'Failed to fetch Binance ticker price');
      }
    }
  }

  async _pollBulkPrices(symbols) {
    try {
      const response = await fetch(`${REST_BASE_URL}/fapi/v1/ticker/price`);
      if (!response.ok) {
        throw new Error(`Binance bulk price request failed: ${response.status}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error('Binance bulk price payload was not an array');
      }
      const wanted = new Set(symbols);
      const now = Date.now();
      for (const entry of payload) {
        const symbol = entry?.symbol;
        if (!wanted.has(symbol)) continue;
        const price = Number(entry.price);
        if (Number.isNaN(price)) continue;
        this.emit('tick', {
          symbol,
          price,
          eventTime: now,
        });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to fetch Binance bulk ticker prices');
    }
  }
}

export class BinanceClient {
  constructor() {
    this.baseUrl = REST_BASE_URL;
    this.symbolFilters = new Map();
    this.exchangeInfo = { timestamp: 0, ttl: EXCHANGE_INFO_TTL_MS, map: new Map() };
  }

  async fetchKlines(symbol, interval = '1m', limit = 120) {
    const params = new URLSearchParams({
      symbol,
      interval,
      limit: String(Math.max(1, Math.min(limit, 500))),
    });
    const response = await fetch(`${this.baseUrl}/fapi/v1/klines?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Binance klines request failed: ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Binance klines payload was not an array');
    }
    return data.map((entry) => ({
      openTime: Number(entry[0]),
      open: Number(entry[1]),
      high: Number(entry[2]),
      low: Number(entry[3]),
      close: Number(entry[4]),
      volume: Number(entry[5]),
      closeTime: Number(entry[6]),
    }));
  }

  async fetchHistoricalKlines(symbol, interval = '1m', options = {}) {
    const maxCandles = Math.max(1, Math.min(Number(options.maxCandles ?? 500), 5000));
    const endTime = options.endTime ? Number(options.endTime) : undefined;
    let cursor = options.startTime ? Number(options.startTime) : undefined;
    let fetched = 0;
    const candles = [];

    while (fetched < maxCandles) {
      const batchLimit = Math.min(500, maxCandles - fetched);
      const params = new URLSearchParams({
        symbol,
        interval,
        limit: String(batchLimit),
      });
      if (cursor !== undefined) {
        params.set('startTime', String(cursor));
      }
      if (endTime !== undefined) {
        params.set('endTime', String(endTime));
      }

      const response = await fetch(`${this.baseUrl}/fapi/v1/klines?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Binance klines request failed: ${response.status}`);
      }
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      for (const entry of data) {
        candles.push({
          openTime: Number(entry[0]),
          open: Number(entry[1]),
          high: Number(entry[2]),
          low: Number(entry[3]),
          close: Number(entry[4]),
          volume: Number(entry[5]),
          closeTime: Number(entry[6]),
        });
      }

      fetched += data.length;
      const last = candles[candles.length - 1];
      if (!last) {
        break;
      }

      const nextCursor = last.closeTime + 1;
      if (cursor !== undefined && nextCursor <= cursor) {
        break;
      }

      cursor = nextCursor;
      if (endTime !== undefined && cursor > endTime) {
        break;
      }

      if (data.length < batchLimit) {
        break;
      }
    }

    return candles.slice(0, maxCandles);
  }

  async fetch24hTicker(symbol) {
    try {
      const response = await fetch(
        `${this.baseUrl}/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
      );
      if (!response.ok) {
        throw new Error(`Binance 24hr ticker request failed: ${response.status}`);
      }
      const payload = await response.json();
      return {
        priceChangePercent: Number(payload.priceChangePercent ?? 0),
        lastPrice: Number(payload.lastPrice ?? 0),
        openPrice: Number(payload.openPrice ?? 0),
        highPrice: Number(payload.highPrice ?? 0),
        lowPrice: Number(payload.lowPrice ?? 0),
        volume: Number(payload.volume ?? 0),
        quoteVolume: Number(payload.quoteVolume ?? 0),
        closeTime: Number(payload.closeTime ?? Date.now()),
      };
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to fetch Binance 24hr ticker');
      throw error;
    }
  }

  async fetchFundingRate(symbol) {
    try {
      const response = await fetch(
        `${this.baseUrl}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`
      );
      if (!response.ok) {
        throw new Error(`Binance funding rate request failed: ${response.status}`);
      }
      const payload = await response.json();
      return {
        markPrice: Number(payload.markPrice ?? 0),
        indexPrice: Number(payload.indexPrice ?? 0),
        lastFundingRate: Number(payload.lastFundingRate ?? 0),
        nextFundingTime: Number(payload.nextFundingTime ?? 0),
        estimatedSettlePrice: Number(payload.estimatedSettlePrice ?? 0),
      };
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to fetch Binance funding data');
      throw error;
    }
  }

  async fetchOpenInterest(symbol) {
    try {
      const response = await fetch(
        `${this.baseUrl}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`
      );
      if (!response.ok) {
        throw new Error(`Binance open interest request failed: ${response.status}`);
      }
      const payload = await response.json();
      return {
        openInterest: Number(payload.openInterest ?? 0),
        time: Number(payload.time ?? Date.now()),
      };
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to fetch Binance open interest');
      throw error;
    }
  }

  async fetchTakerLongShortRatio(symbol, period = '5m', limit = 12) {
    try {
      const params = new URLSearchParams({
        symbol,
        period,
        limit: String(Math.max(1, Math.min(limit, 500))),
      });
      const response = await fetch(
        `${this.baseUrl}/futures/data/takerlongshortRatio?${params.toString()}`
      );
      if (!response.ok) {
        throw new Error(`Binance taker ratio request failed: ${response.status}`);
      }
      const raw = await response.text();
      if (!raw || raw.trim().length === 0) {
        return [];
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (parseError) {
        logger.warn({ error: parseError, symbol, period, limit }, 'Unable to parse Binance taker ratio payload');
        return [];
      }
      if (!Array.isArray(payload)) {
        logger.warn({ symbol, period, limit }, 'Binance taker ratio payload was not an array');
        return [];
      }
      return payload.map((entry) => ({
        buyVolume: Number(entry.buyVol ?? 0),
        sellVolume: Number(entry.sellVol ?? 0),
        buySellRatio: Number(entry.buySellRatio ?? 0),
        timestamp: Number(entry.timestamp ?? entry.time ?? 0),
      }));
    } catch (error) {
      logger.error({ error, symbol, period, limit }, 'Failed to fetch Binance taker long/short ratio');
      return [];
    }
  }

  signParams(params) {
    const timestamp = Date.now();
    const query = new URLSearchParams({ ...params, timestamp: String(timestamp) });
    const hmac = crypto.createHmac('sha256', config.binance.apiSecret);
    hmac.update(query.toString());
    query.append('signature', hmac.digest('hex'));
    return query.toString();
  }

  async request(method, path, params = {}) {
    const query = this.signParams(params);
    const url = `${this.baseUrl}${path}?${query}`;
    const response = await fetch(url, {
      method,
      headers: { 'X-MBX-APIKEY': config.binance.apiKey },
    });
    const text = await response.text();
    if (!response.ok) {
      let details = '';
      if (text) {
        try {
          const payload = JSON.parse(text);
          if (payload?.msg) {
            details = ` (${payload.msg})`;
          }
        } catch (_error) {
          details = ` (${text})`;
        }
      }
      throw new Error(`Binance request failed: ${response.status}${details}`);
    }
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      logger.error({ error, path, method }, 'Failed to parse Binance response payload');
      throw error;
    }
  }

  async ensureExchangeInfo(options = {}) {
    const ttl = Number.isFinite(options.ttl) ? Number(options.ttl) : this.exchangeInfo.ttl ?? EXCHANGE_INFO_TTL_MS;
    const now = Date.now();
    if (!options.force && this.exchangeInfo.map.size > 0 && now - this.exchangeInfo.timestamp < ttl) {
      return this.exchangeInfo.map;
    }

    try {
      const response = await fetch(`${this.baseUrl}/fapi/v1/exchangeInfo`);
      if (!response.ok) {
        throw new Error(`Binance exchange info request failed: ${response.status}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.symbols)) {
        throw new Error('Binance exchange info payload missing symbols');
      }

      const map = new Map();
      const filtersCache = new Map();

      for (const entry of payload.symbols) {
        const symbol = typeof entry?.symbol === 'string' ? entry.symbol.toUpperCase() : null;
        if (!symbol) continue;

        const filters = buildFiltersFromExchangeInfo(entry);
        const quoteAsset = typeof entry?.quoteAsset === 'string' ? entry.quoteAsset.toUpperCase() : null;
        const descriptor = {
          symbol,
          contractType: entry?.contractType ?? null,
          status: entry?.status ?? null,
          quoteAsset,
          baseAsset: typeof entry?.baseAsset === 'string' ? entry.baseAsset.toUpperCase() : null,
          marginAsset: typeof entry?.marginAsset === 'string' ? entry.marginAsset.toUpperCase() : null,
          filters,
          raw: entry,
        };
        descriptor.isPerpetual = descriptor.contractType === 'PERPETUAL';
        descriptor.isLinear = descriptor.marginAsset === 'USDT';
        descriptor.isTrading = descriptor.status === 'TRADING';
        descriptor.isTradable = descriptor.isPerpetual && descriptor.isTrading;
        map.set(symbol, descriptor);
        filtersCache.set(symbol, filters);
      }

      this.exchangeInfo = { timestamp: now, ttl, map };
      this.symbolFilters = filtersCache;
      return map;
    } catch (error) {
      logger.error({ error }, 'Failed to refresh Binance exchange info');
      throw error;
    }
  }

  async getSymbolMeta(symbol) {
    const key = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    if (!key) {
      return null;
    }
    const map = await this.ensureExchangeInfo();
    return map.get(key) ?? null;
  }

  async filterTradableSymbols(symbols, options = {}) {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return [];
    }

    const map = await this.ensureExchangeInfo();
    const quoteAssetSet = options.quoteAssetSet ?? normalizeQuoteAssetFilter(options.quoteAssets);
    const result = [];
    const seen = new Set();
    for (const entry of symbols) {
      const key = typeof entry === 'string' ? entry.trim().toUpperCase() : '';
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const meta = map.get(key);
      if (!meta || !meta.isTradable) {
        continue;
      }
      if (quoteAssetSet && quoteAssetSet.size > 0 && (!meta.quoteAsset || !quoteAssetSet.has(meta.quoteAsset))) {
        continue;
      }
      result.push(meta.symbol);
    }
    return result;
  }

  isSymbolTradableCached(symbol, options = {}) {
    const key = typeof symbol === 'string' ? symbol.toUpperCase() : '';
    if (!key || !this.exchangeInfo?.map?.size) {
      return false;
    }
    const meta = this.exchangeInfo.map.get(key);
    if (!meta || !meta.isTradable) {
      return false;
    }
    const quoteAssetSet = options.quoteAssetSet ?? normalizeQuoteAssetFilter(options.quoteAssets);
    if (quoteAssetSet && quoteAssetSet.size > 0) {
      return Boolean(meta.quoteAsset) && quoteAssetSet.has(meta.quoteAsset);
    }
    return true;
  }

  async fetchSymbolFilters(symbol) {
    const key = typeof symbol === 'string' ? symbol.toUpperCase() : '';
    if (!key) {
      throw new Error('Symbol is required to fetch Binance filters');
    }

    if (this.symbolFilters.has(key)) {
      return this.symbolFilters.get(key);
    }

    const meta = await this.getSymbolMeta(key);
    if (!meta) {
      throw new Error(`Symbol ${key} not listed on Binance futures exchange`);
    }
    if (!meta.isTradable) {
      throw new Error(`Symbol ${key} is not tradable on Binance futures`);
    }

    this.symbolFilters.set(key, meta.filters);
    return meta.filters;
  }

  static quantize(value, stepSize) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (!Number.isFinite(stepSize) || stepSize <= 0) {
      return Number(value.toFixed(6));
    }
    const precision = Math.min(8, Math.max(0, Math.round(-Math.log10(stepSize))));
    const steps = Math.floor(value / stepSize);
    const quantized = steps * stepSize;
    return Number(quantized.toFixed(precision));
  }

  async ensureTradableQuantity(symbol, desiredQty, referencePrice) {
    if (!Number.isFinite(desiredQty) || desiredQty <= 0) {
      return { quantity: 0, quantityText: undefined, filters: undefined };
    }

    try {
      const filters = await this.fetchSymbolFilters(symbol);
      let quantity = filters.stepSize > 0
        ? BinanceClient.quantize(desiredQty, filters.stepSize)
        : Number(desiredQty);

      if (quantity < filters.minQty) {
        if (filters.stepSize > 0) {
          const minSteps = Math.ceil(filters.minQty / filters.stepSize);
          quantity = BinanceClient.quantize(minSteps * filters.stepSize, filters.stepSize);
        } else {
          quantity = filters.minQty;
        }
      }

      if (Number.isFinite(filters.maxQty) && filters.maxQty > 0 && quantity > filters.maxQty) {
        quantity = filters.maxQty;
      }

      if (Number.isFinite(referencePrice) && referencePrice > 0 && filters.minNotional > 0) {
        const notional = quantity * referencePrice;
        if (notional < filters.minNotional) {
          const requiredQty = filters.minNotional / referencePrice;
          quantity = filters.stepSize > 0
            ? BinanceClient.quantize(requiredQty, filters.stepSize)
            : requiredQty;

          if (Number.isFinite(filters.maxQty) && filters.maxQty > 0 && quantity > filters.maxQty) {
            return { quantity: 0, quantityText: undefined, filters };
          }
        }
      }

      if (Number.isFinite(filters.maxQty) && filters.maxQty > 0 && quantity > filters.maxQty) {
        quantity = filters.maxQty;
      }

      const precisionCaps = [];
      if (Number.isInteger(filters.quantityPrecision)) {
        precisionCaps.push(filters.quantityPrecision);
      }
      if (Number.isInteger(filters.stepSizePrecision)) {
        precisionCaps.push(filters.stepSizePrecision);
      }
      const maxPrecision = precisionCaps.length > 0 ? Math.min(...precisionCaps) : undefined;
      if (Number.isInteger(maxPrecision) && maxPrecision >= 0) {
        const factor = 10 ** maxPrecision;
        quantity = Math.floor(quantity * factor + 1e-12) / factor;
        if (filters.stepSize > 0) {
          quantity = BinanceClient.quantize(quantity, filters.stepSize);
        }
        quantity = Number(quantity.toFixed(Math.min(maxPrecision, 8)));
      } else if (filters.stepSize > 0) {
        quantity = BinanceClient.quantize(quantity, filters.stepSize);
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        return { quantity: 0, quantityText: undefined, filters };
      }

      if (Number.isFinite(referencePrice) && referencePrice > 0) {
        const notional = quantity * referencePrice;
        if (filters.maxNotional && Number.isFinite(filters.maxNotional) && notional > filters.maxNotional) {
          return { quantity: 0, quantityText: undefined, filters };
        }
        if (filters.minNotional > 0 && notional < filters.minNotional) {
          return { quantity: 0, quantityText: undefined, filters };
        }
      }

      if (quantity < filters.minQty) {
        quantity = filters.stepSize > 0
          ? BinanceClient.quantize(filters.minQty, filters.stepSize)
          : filters.minQty;
      }

      if (!Number.isFinite(quantity) || quantity <= 0 || quantity < filters.minQty) {
        return { quantity: 0, quantityText: undefined, filters };
      }

      const precisionForText = (() => {
        if (Number.isInteger(filters.quantityPrecision)) {
          return Math.max(0, filters.quantityPrecision);
        }
        if (Number.isInteger(filters.stepSizePrecision)) {
          return Math.max(0, filters.stepSizePrecision);
        }
        if (filters.stepSize > 0) {
          const digits = String(filters.stepSize).split('.')[1];
          if (digits) {
            return Math.min(digits.length, 8);
          }
        }
        return 6;
      })();

      const quantityText = Number.isInteger(precisionForText)
        ? quantity.toFixed(Math.min(precisionForText, 8))
        : quantity.toString();

      return {
        quantity: Number(quantityText),
        quantityText,
        filters,
      };
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to normalize Binance quantity');
      return { quantity: 0, quantityText: undefined, filters: undefined };
    }
  }

  async fetchAccountBalance() {
    try {
      const data = await this.request('GET', '/fapi/v2/account');
      return (data.assets ?? []).map((asset) => ({
        asset: asset.asset,
        balance: Number(asset.walletBalance),
        available: Number(asset.availableBalance),
      }));
    } catch (error) {
      logger.error({ error }, 'Unable to fetch Binance account balance');
      throw error;
    }
  }

  async fetchPositions() {
    try {
      const data = await this.request('GET', '/fapi/v2/positionRisk');
      return (data ?? []).map((position) => ({
        symbol: position.symbol,
        positionAmt: Number(position.positionAmt),
        entryPrice: Number(position.entryPrice),
        unrealizedProfit: Number(position.unRealizedProfit ?? position.unrealizedProfit ?? 0),
      }));
    } catch (error) {
      logger.error({ error }, 'Unable to fetch Binance positions');
      throw error;
    }
  }

  async setLeverage(symbol, leverage) {
    try {
      await this.request('POST', '/fapi/v1/leverage', { symbol, leverage });
    } catch (error) {
      logger.error({ error, symbol, leverage }, 'Failed to set Binance leverage');
      throw error;
    }
  }

  async placeMarketOrder(symbol, side, quantity) {
    try {
      const data = await this.request('POST', '/fapi/v1/order', {
        symbol,
        side,
        type: 'MARKET',
        quantity,
      });
      return {
        orderId: String(data.orderId),
        status: data.status,
        avgPrice: Number(data.avgPrice ?? data.price ?? 0),
        executedQty: Number(data.executedQty ?? data.origQty ?? 0),
      };
    } catch (error) {
      logger.error({ error, symbol, side, quantity }, 'Failed to execute Binance market order');
      throw error;
    }
  }

  async fetchTopMovers(options = {}) {
    const limit = Number.isFinite(options.limit) ? Number(options.limit) : 50;
    const minQuoteVolume = Number.isFinite(options.minQuoteVolume)
      ? Number(options.minQuoteVolume)
      : 0;
    const quoteAssetSet = normalizeQuoteAssetFilter(options.quoteAssets) ?? null;

    await this.ensureExchangeInfo();

    const response = await fetch(`${this.baseUrl}/fapi/v1/ticker/24hr`);
    if (!response.ok) {
      throw new Error(`Binance 24hr ticker request failed: ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Binance 24hr ticker payload was not an array');
    }

    const ranked = [];
    for (const entry of data) {
      const symbol = typeof entry.symbol === 'string' ? entry.symbol.toUpperCase() : undefined;
      if (!symbol) continue;
      if (!this.isSymbolTradableCached(symbol, { quoteAssetSet })) {
        continue;
      }

      const meta = this.exchangeInfo.map.get(symbol);
      const quoteAsset = meta?.quoteAsset ?? undefined;

      const priceChangePercent = Number(entry.priceChangePercent ?? entry.priceChange_pct ?? entry.priceChange);
      const lastPrice = Number(entry.lastPrice ?? entry.prevClosePrice ?? entry.close ?? entry.price);
      const quoteVolume = Number(entry.quoteVolume ?? entry.volume ?? 0);
      const baseVolume = Number(entry.volume ?? 0);

      if (
        !Number.isFinite(priceChangePercent) ||
        !Number.isFinite(lastPrice) ||
        !Number.isFinite(quoteVolume)
      ) {
        continue;
      }
      if (quoteVolume < minQuoteVolume) {
        continue;
      }

      const absChange = Math.abs(priceChangePercent);
      const liquidityBoost = Math.log10(Math.max(quoteVolume, 1) + 10);
      const score = absChange * liquidityBoost;

      ranked.push({
        symbol,
        quoteAsset,
        priceChangePercent,
        lastPrice,
        quoteVolume,
        baseVolume,
        score,
        direction: priceChangePercent >= 0 ? 'up' : 'down',
      });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  }
}
