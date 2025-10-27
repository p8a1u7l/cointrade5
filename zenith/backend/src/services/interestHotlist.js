import { logger } from '../utils/logger.js';

const DISABLED_REASON = {
  code: 'removed',
  message: 'Interest watcher disabled in lightweight trading mode',
};

let cache = {
  timestamp: 0,
  payload: { entries: [], totals: [], updatedAt: 0 },
};

export function __resetInterestHotlistCacheForTests() {
  cache = { timestamp: 0, payload: { entries: [], totals: [], updatedAt: 0 } };
}

export function isInterestWatcherEnabled() {
  return false;
}

export function getInterestWatcherStatus() {
  return { enabled: false, reason: { ...DISABLED_REASON } };
}

export function setInterestWatcherEnabled(enabled) {
  if (enabled) {
    logger.warn('Interest watcher enable request ignored; watcher is unavailable in this mode');
  }
  return getInterestWatcherStatus();
}

export async function getInterestHotlist(options = {}) {
  const now = Date.now();
  const minInterval = Number.isFinite(options.cacheTtlMs) ? Number(options.cacheTtlMs) : 60_000;

  if (!options.force && now - cache.timestamp < minInterval) {
    return cache.payload;
  }

  cache = {
    timestamp: now,
    payload: {
      entries: [],
      totals: [],
      updatedAt: now,
    },
  };

  return cache.payload;
}
