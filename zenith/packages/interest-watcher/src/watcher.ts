import { fetchCryptoPanic } from './source-cryptopanic';
import { fetchReddit } from './source-reddit';
import { extractSymbols } from './tokenize';
import { readState, writeDailyJson, writeState } from './storage';
import { computeHot } from './interests';
import { CFG } from './config';
import { Item } from './types';

const MIN_INTERVAL_MS = Number(process.env.CRYPTO_WATCH_MIN_INTERVAL_MS ?? 30_000);
const BREAKER_TRIP_COUNT = Number(process.env.CRYPTO_WATCH_TRIP_COUNT ?? 3);
const BREAKER_SLEEP_MS = Number(process.env.CRYPTO_WATCH_TRIP_SLEEP_MS ?? 900_000);

let lastRun = 0;
let running = false;
let consecutive429 = 0;
let breakerUntil = 0;

type WatcherOptions = {
  token: string;
  filter?: string;
  currencies?: string;
  kind?: string;
};

type WatcherSuccess = {
  items: Awaited<ReturnType<typeof fetchCryptoPanic>>['items'];
  count: number;
};

type WatcherSkip =
  | { skipped: true; reason: 'breaker' | 'already_running' | 'interval_guard' }
  | { error: 'rate_limited_breaker_tripped'; until: number };

export class InterestWatcher {
  private readonly token: string;

  private readonly filter?: string;

  private readonly currencies?: string;

  private readonly kind?: string;

  constructor({ token, filter, currencies, kind }: WatcherOptions) {
    this.token = token;
    this.filter = filter;
    this.currencies = currencies;
    this.kind = kind;
  }

  async runWatcher(): Promise<WatcherSuccess | WatcherSkip> {
    const now = Date.now();
    if (now < breakerUntil) return { skipped: true, reason: 'breaker' };
    if (running) return { skipped: true, reason: 'already_running' };
    if (now - lastRun < MIN_INTERVAL_MS) return { skipped: true, reason: 'interval_guard' };

    running = true;
    try {
      lastRun = now;
      const { items, count } = await fetchCryptoPanic({
        authToken: this.token,
        filter: this.filter,
        currencies: this.currencies,
        kind: this.kind,
      });
      consecutive429 = 0;
      return { items, count };
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 429) {
        consecutive429 += 1;
        if (consecutive429 >= BREAKER_TRIP_COUNT) {
          breakerUntil = Date.now() + BREAKER_SLEEP_MS;
          return { error: 'rate_limited_breaker_tripped', until: breakerUntil };
        }
      }
      throw error;
    } finally {
      running = false;
    }
  }
}

const defaultWatcher = new InterestWatcher({
  token: process.env.CRYPTOPANIC_TOKEN ?? '',
  filter: process.env.CRYPTOPANIC_FILTER ?? 'important',
  currencies: process.env.CRYPTOPANIC_CURRENCIES,
  kind: process.env.CRYPTOPANIC_KIND,
});

function mapCryptoItems(items: WatcherSuccess['items']): Item[] {
  return items
    .map((entry) => {
      const tsSource =
        typeof entry.published_at === 'string'
          ? entry.published_at
          : undefined;
      const ts = tsSource ? Date.parse(tsSource) : Number.NaN;
      const url = typeof entry.url === 'string' ? entry.url : undefined;
      const title = typeof entry.title === 'string' ? entry.title : undefined;
      if (!Number.isFinite(ts) || !url || !title) {
        return null;
      }
      return {
        id: String(entry.id ?? `${url}:${ts}`),
        title,
        url,
        timestamp: ts,
        source: `cryptopanic:${entry.domain ?? 'news'}`,
        body: undefined,
        author: typeof entry.domain === 'string' ? entry.domain : undefined,
      } as Item;
    })
    .filter((value): value is Item => Boolean(value));
}

async function fetchCryptoNews(): Promise<Item[]> {
  try {
    const result = await defaultWatcher.runWatcher();
    if ('skipped' in result || 'error' in result) {
      return [];
    }
    return mapCryptoItems(result.items);
  } catch (error) {
    console.warn(
      `[interest] crypto fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

export async function runWatcher() {
  const now = Date.now();
  const state = readState(CFG.stateDir);

  const pull: Item[] = [
    ...(await fetchCryptoNews()),
    ...(await fetchReddit()),
  ];

  const tokens = pull.flatMap(extractSymbols);
  const per = new Map<string, typeof tokens>();
  for (const token of tokens) {
    if (!per.has(token.symbol)) per.set(token.symbol, []);
    per.get(token.symbol)!.push(token);
  }

  const { hot, nextState } = computeHot(per, state.symbols, now);
  const payload = {
    windowMin: CFG.windowMin,
    hotZ: CFG.hotZ,
    minCount: CFG.minCount,
    minSources: CFG.minSources,
    now,
    hot,
    totals: Array.from(per.entries()).map(([symbol, arr]) => ({
      symbol,
      mentions: arr.length,
    })),
  };

  writeState(CFG.stateDir, { symbols: nextState, lastRun: now });
  const file = writeDailyJson(CFG.outDir, payload);
  console.log(
    `[interest] saved: ${file} | hot=${hot.map((h) => h.symbol).join(',') || '-'}`
  );
  return payload;
}
