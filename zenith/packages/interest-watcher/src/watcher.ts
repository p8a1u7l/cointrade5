import { fetchCryptoPanic } from './source-cryptopanic';
import { fetchReddit } from './source-reddit';
import { extractSymbols } from './tokenize';
import { readState, writeDailyJson, writeState } from './storage';
import { computeHot } from './interests';
import { CFG } from './config';
import { Item } from './types';

export async function runWatcher() {
  const now = Date.now();
  const state = readState(CFG.stateDir);

  const pull: Item[] = [
    ...(await fetchCryptoPanic()),
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
    `[interest] saved: ${file} | hot=${hot.map((h) => h.symbol).join(',') || '-'}`,
  );
  return payload;
}
