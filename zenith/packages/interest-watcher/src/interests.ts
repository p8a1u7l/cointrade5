import { CFG } from './config';
import { HotSymbol, InterestMetrics, SymbolState, Tokenized } from './types';

function withinWindow(ts: number, now: number, windowMin: number) {
  return now - ts <= windowMin * 60 * 1000;
}

function uniq<T>(values: T[]) {
  return Array.from(new Set(values));
}

function calcMetrics(tokens: Tokenized[], now: number): InterestMetrics {
  const count = tokens.length;
  const minutes = Math.max(1, CFG.windowMin);
  const velocity = count / minutes;
  const diversity = uniq(tokens.map((t) => t.source)).length;
  const recent30 = tokens.filter((t) => withinWindow(t.ts, now, 30)).length;
  const recent45 = tokens.filter((t) => withinWindow(t.ts, now, 45)).length;
  const novelty = Math.min(1, recent30 / Math.max(1, count));
  const momentum = Math.min(
    1,
    Math.max(0, (recent30 - recent45 * 0.6) / Math.max(1, count)),
  );
  return { count, velocity, diversity, novelty, momentum };
}

function updateEwmaVar(
  prev: SymbolState | undefined,
  x: number,
  decay: number,
  now: number,
): SymbolState {
  if (!prev) {
    return { ewma: x, var: 1, lastSeen: now, recentTs: [], recentSources: [] };
  }
  const mu = prev.ewma + decay * (x - prev.ewma);
  const variance = Math.max(1e-6, prev.var + decay * ((x - prev.ewma) ** 2 - prev.var));
  return { ...prev, ewma: mu, var: variance, lastSeen: now };
}

export function computeHot(
  perSymbolTokens: Map<string, Tokenized[]>,
  prev: Record<string, SymbolState>,
  now: number,
): { hot: HotSymbol[]; nextState: Record<string, SymbolState> } {
  const next: Record<string, SymbolState> = { ...prev };
  const hot: HotSymbol[] = [];

  for (const [symbol, tokens] of perSymbolTokens.entries()) {
    const toksInWindow = tokens.filter((token) =>
      withinWindow(token.ts, now, CFG.windowMin),
    );
    if (!toksInWindow.length) continue;

    const metrics = calcMetrics(toksInWindow, now);
    const composite =
      0.4 * metrics.velocity +
      0.25 * metrics.novelty +
      0.2 * metrics.momentum +
      0.15 * Math.min(1, metrics.diversity / 3);

    const st0 = prev[symbol];
    const st1 = updateEwmaVar(st0, composite, CFG.baseDecay, now);
    st1.recentTs = [
      ...(st1.recentTs ?? []),
      ...toksInWindow.map((token) => token.ts),
    ].filter((ts) => withinWindow(ts, now, CFG.windowMin));
    st1.recentSources = uniq([
      ...(st1.recentSources ?? []),
      ...toksInWindow.map((token) => token.source),
    ]).slice(-20);
    next[symbol] = st1;

    const sd = Math.sqrt(Math.max(1e-6, st1.var));
    const z = sd > 0 ? (composite - st1.ewma) / sd : 0;
    const hotEnough =
      metrics.count >= CFG.minCount &&
      metrics.diversity >= CFG.minSources &&
      z >= CFG.hotZ;
    if (hotEnough) {
      hot.push({ symbol, score: z, z, metrics });
    }
  }

  hot.sort((a, b) => b.score - a.score);
  return { hot, nextState: next };
}
