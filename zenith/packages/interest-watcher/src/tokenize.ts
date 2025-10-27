import { Item, Tokenized } from './types';

const ALIASES: Record<string, string[]> = {
  BTC: ['btc', 'bitcoin', '$btc', 'btcusdt', 'xbt'],
  ETH: ['eth', 'ethereum', '$eth', 'ethusdt'],
  SOL: ['sol', 'solana', '$sol', 'solusdt'],
  XRP: ['xrp', 'ripple', '$xrp', 'xrpusdt'],
  ADA: ['ada', 'cardano', '$ada', 'adausdt'],
  DOGE: ['doge', 'dogecoin', '$doge', 'dogeusdt'],
};
const SYM_FROM_TAG: Record<string, string> = {
  BTC: 'BTC',
  XBT: 'BTC',
  ETH: 'ETH',
  SOL: 'SOL',
  XRP: 'XRP',
  ADA: 'ADA',
  DOGE: 'DOGE',
};
function normalize(value: string) {
  return (value ?? '').toLowerCase();
}

export function extractSymbols(item: Item): Tokenized[] {
  const text = normalize(`${item.title ?? ''} ${item.body ?? ''}`);
  const out: Tokenized[] = [];
  const ts = item.timestamp;

  for (const tag of item.symbols ?? []) {
    const sym = SYM_FROM_TAG[tag.toUpperCase()];
    if (sym) {
      out.push({ symbol: sym, raw: tag, source: item.source, ts });
    }
  }

  for (const [sym, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      if (text.includes(alias.toLowerCase())) {
        out.push({ symbol: sym, raw: alias, source: item.source, ts });
        break;
      }
    }
  }

  const dedup = new Map<string, Tokenized>();
  for (const token of out) {
    const key = `${token.symbol}:${token.source}:${token.ts}`;
    if (!dedup.has(key)) {
      dedup.set(key, token);
    }
  }
  return Array.from(dedup.values());
}
