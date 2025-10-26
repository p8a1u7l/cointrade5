import { fetchCryptoPanic } from "./source-cryptopanic.js";
import { fetchReddit } from "./source-reddit.js";
import { extractSymbols } from "./tokenize.js";
import { readState, writeState, writeDailyJson } from "./storage.js";
import { computeHot } from "./interests.js";
import { CFG } from "./config.js";
import { Item } from "./types.js";

export async function runWatcher(){
  const now = Date.now();
  const st = readState(CFG.stateDir);

  const pull: Item[] = [
    ...(await fetchCryptoPanic()),
    ...(await fetchReddit())
  ];

  const tokens = pull.flatMap(extractSymbols);
  const per = new Map<string, typeof tokens>();
  for (const t of tokens){
    if (!per.has(t.symbol)) per.set(t.symbol, []);
    per.get(t.symbol)!.push(t);
  }

  const { hot, nextState } = computeHot(per, st.symbols, now);
  const payload = {
    windowMin: CFG.windowMin, hotZ: CFG.hotZ, minCount: CFG.minCount, minSources: CFG.minSources,
    now, hot,
    totals: Array.from(per.entries()).map(([s, arr])=>({symbol:s, mentions:arr.length}))
  };

  writeState(CFG.stateDir, { symbols: nextState, lastRun: now });
  const file = writeDailyJson(CFG.outDir, payload);
  console.log(`[interest] saved: ${file} | hot=${hot.map(h=>h.symbol).join(",")||"-"}`);
  return payload;
}
