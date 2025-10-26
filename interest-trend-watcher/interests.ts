import { CFG } from "./config.js";
import { Tokenized, InterestMetrics, SymbolState, HotSymbol } from "./types.js";

function withinWindow(ts: number, now: number, windowMin: number){ 
  return (now - ts) <= windowMin*60*1000; 
}
function uniq<T>(arr:T[]){ return Array.from(new Set(arr)); }

function calcMetrics(tokens: Tokenized[], now:number): InterestMetrics {
  const count = tokens.length;
  const minutes = Math.max(1, CFG.windowMin);
  const velocity = count / minutes;
  const diversity = uniq(tokens.map(t=>t.source)).length;
  const recent30 = tokens.filter(t=> withinWindow(t.ts, now, 30)).length;
  const recent45 = tokens.filter(t=> withinWindow(t.ts, now, 45)).length;
  const novelty = Math.min(1, recent30 / Math.max(1, count));
  const momentum = Math.min(1, Math.max(0, (recent30 - recent45*0.6) / Math.max(1, count)));
  return { count, velocity, diversity, novelty, momentum };
}

function updateEwmaVar(prev: SymbolState|undefined, x:number, decay:number, now:number): SymbolState {
  if (!prev){ return { ewma: x, var: 1, lastSeen: now, recentTs: [], recentSources: [] }; }
  const mu = prev.ewma + decay*(x - prev.ewma);
  const variance = Math.max(1e-6, prev.var + decay*((x - prev.ewma)**2 - prev.var));
  return { ...prev, ewma: mu, var: variance, lastSeen: now };
}

export function computeHot(
  perSymbolTokens: Map<string, Tokenized[]>,
  prev: Record<string, SymbolState>,
  now: number
): { hot: HotSymbol[], nextState: Record<string, SymbolState> } {
  const next: Record<string, SymbolState> = { ...prev };
  const hot: HotSymbol[] = [];

  for (const [sym, toks] of perSymbolTokens.entries()) {
    const toksInWin = toks.filter(t=> withinWindow(t.ts, now, CFG.windowMin));
    if (!toksInWin.length) continue;

    const m = calcMetrics(toksInWin, now);
    const composite = (
      0.40 * m.velocity +
      0.25 * m.novelty +
      0.20 * m.momentum +
      0.15 * Math.min(1, m.diversity/3)
    );

    const st0 = prev[sym];
    const st1 = updateEwmaVar(st0, composite, CFG.baseDecay, now);
    st1.recentTs = [...(st1.recentTs||[]), ...toksInWin.map(t=>t.ts)].filter(ts=> withinWindow(ts, now, CFG.windowMin));
    st1.recentSources = uniq([...(st1.recentSources||[]), ...toksInWin.map(t=>t.source)]).slice(-20);
    next[sym] = st1;

    const sd = Math.sqrt(Math.max(1e-6, st1.var));
    const z = sd>0 ? (composite - st1.ewma) / sd : 0;
    const hotEnough =
      (m.count >= CFG.minCount) &&
      (m.diversity >= CFG.minSources) &&
      (z >= CFG.hotZ);
    if (hotEnough) hot.push({ symbol: sym, score: z, z, metrics: m });
  }

  hot.sort((a,b)=> b.score - a.score);
  return { hot, nextState: next };
}
