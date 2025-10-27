import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const interestCfg = config.interestWatcher ?? { enabled: false };
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '../../..');
const tsconfigPath = path.resolve(repoRoot, 'tsconfig.json');
const projectDir = interestCfg.projectDir ?? null;
const distModule = interestCfg.distModule ?? null;
const tsEntry = projectDir ? path.resolve(projectDir, 'src/watcher.ts') : null;

let tsApiPromise = null;

let cachedWatcherPromise = null;

async function loadTsWatcher(filePath) {
  if (!tsApiPromise) {
    tsApiPromise = import('tsx/esm/api')
      .then((api) => {
        if (typeof api?.tsImport !== 'function') {
          throw new Error('tsx runtime does not expose tsImport()');
        }
        return api;
      })
      .catch((error) => {
        tsApiPromise = null;
        throw error;
      });
  }

  const api = await tsApiPromise;
  const parentURL = pathToFileURL(path.join(moduleDir, 'interest-hotlist-ts-loader.mjs')).href;
  return api.tsImport(filePath, { parentURL, tsconfig: tsconfigPath });
}

let cache = {
  timestamp: 0,
  payload: { entries: [], totals: [], updatedAt: 0 },
};

let inflightFetch = null;

export function __resetInterestHotlistCacheForTests() {
  cache = { timestamp: 0, payload: { entries: [], totals: [], updatedAt: 0 } };
  cachedWatcherPromise = null;
  tsApiPromise = null;
  inflightFetch = null;
}

export function setInterestWatcherEnabled(enabled) {
  const normalized = enabled === true;
  if (interestCfg.enabled === normalized) {
    return interestCfg.enabled !== false;
  }

  interestCfg.enabled = normalized;
  cache = { timestamp: 0, payload: { entries: [], totals: [], updatedAt: 0 } };
  cachedWatcherPromise = null;
  inflightFetch = null;
  return interestCfg.enabled !== false;
}

export function isInterestWatcherEnabled() {
  return interestCfg.enabled !== false;
}

function ensureEnvBootstrap() {
  if (!projectDir) return;
  const envPath = path.join(projectDir, '.env');
  if (!process.env.DOTENV_CONFIG_PATH && fs.existsSync(envPath)) {
    process.env.DOTENV_CONFIG_PATH = envPath;
  }
  if (interestCfg.dataDir) {
    process.env.OUT_DIR = interestCfg.dataDir;
  }
  if (interestCfg.stateDir) {
    process.env.STATE_DIR = interestCfg.stateDir;
  }
}

async function loadWatcherModule() {
  if (!cachedWatcherPromise) {
    cachedWatcherPromise = (async () => {
      ensureEnvBootstrap();
      const candidates = [];
      if (distModule) {
        candidates.push({ type: 'js', path: distModule });
      }
      if (tsEntry) {
        candidates.push({ type: 'ts', path: tsEntry });
      }

      let lastError = null;
      for (const candidate of candidates) {
        if (!candidate.path || !fs.existsSync(candidate.path)) {
          continue;
        }
        try {
          if (candidate.type === 'ts') {
            return await loadTsWatcher(candidate.path);
          }
          return await import(pathToFileURL(candidate.path).href);
        } catch (error) {
          lastError = error;
        }
      }

      const hints = [];
      if (distModule) {
        hints.push(
          `Run "npm run build --prefix zenith" to compile the interest watcher (expected at ${distModule}).`,
        );
      } else {
        hints.push('Interest watcher dist module path is not configured.');
      }
      if (lastError?.code === 'ERR_MODULE_NOT_FOUND' && /'tsx'/.test(lastError?.message ?? '')) {
        hints.push('Install workspace dependencies with "npm install --prefix zenith" to enable TypeScript fallbacks.');
      }
      const error = new Error(`Interest watcher module could not be loaded. ${hints.join(' ')}`);
      error.cause = lastError;
      throw error;
    })();
  }

  try {
    return await cachedWatcherPromise;
  } catch (error) {
    cachedWatcherPromise = null;
    throw error;
  }
}

function toTradingSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return undefined;
  const quote = (interestCfg.quoteAsset ?? 'USDT').toUpperCase();
  const sanitized = symbol.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!sanitized) return undefined;
  if (sanitized.endsWith(quote)) return sanitized;
  return `${sanitized}${quote}`;
}

function normalizePayload(payload) {
  const now = Number(payload?.now ?? Date.now());
  const rawHot = Array.isArray(payload?.hot) ? payload.hot : [];
  const minScore = Number.isFinite(interestCfg.minScore) ? interestCfg.minScore : 2;
  const entriesMap = new Map();

  for (const item of rawHot) {
    const base = typeof item?.symbol === 'string' ? item.symbol.toUpperCase() : undefined;
    const score = Number(item?.score ?? item?.z ?? 0);
    if (!Number.isFinite(score) || score < minScore) {
      continue;
    }
    const tradingSymbol = toTradingSymbol(base ?? '');
    if (!tradingSymbol) {
      continue;
    }
    const entry = {
      symbol: base ?? tradingSymbol,
      tradingSymbol,
      score,
      z: Number(item?.z ?? score),
      metrics: item?.metrics ?? {},
      updatedAt: now,
    };
    entriesMap.set(tradingSymbol, entry);
  }

  const entries = Array.from(entriesMap.values());
  entries.sort((a, b) => b.score - a.score);
  const limit = Math.max(1, Number(interestCfg.maxSymbols ?? entries.length));
  const limitedEntries = entries.slice(0, limit);

  return {
    entries: limitedEntries,
    totals: Array.isArray(payload?.totals) ? payload.totals : [],
    updatedAt: now,
  };
}

async function runWatcher() {
  const mod = await loadWatcherModule();
  if (typeof mod.runWatcher !== 'function') {
    throw new Error('Interest watcher module does not export runWatcher');
  }
  return mod.runWatcher();
}

export async function getInterestHotlist(options = {}) {
  if (!interestCfg.enabled) {
    return { entries: [], totals: [], updatedAt: 0 };
  }
  const now = Date.now();
  const force = options.force === true;
  const defaultStale = Number.isFinite(interestCfg.staleMs) ? interestCfg.staleMs : 5 * 60 * 1000;
  const ttlEnv = Number(process.env.INTEREST_HOTLIST_TTL_MS);
  const ttlMs = Number.isFinite(ttlEnv) && ttlEnv > 0 ? ttlEnv : defaultStale;

  if (!force && cache.payload.entries.length > 0 && now - cache.timestamp < ttlMs) {
    return cache.payload;
  }

  if (!force && inflightFetch) {
    return inflightFetch;
  }

  const fetchPromise = (async () => {
    try {
      const payload = await runWatcher();
      const normalized = normalizePayload(payload);
      cache = { timestamp: Date.now(), payload: normalized };
      return normalized;
    } catch (error) {
      logger.warn({ error }, 'Failed to refresh interest hotlist');
      if (cache.payload.entries.length > 0) {
        return cache.payload;
      }
      return { entries: [], totals: [], updatedAt: 0 };
    } finally {
      inflightFetch = null;
    }
  })();

  if (!force) {
    inflightFetch = fetchPromise;
  }

  return fetchPromise;
}
