import { z } from 'zod';

export const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url().or(z.string()),
  timestamp: z.number(),
  source: z.string(),
  symbols: z.array(z.string()).optional(),
  body: z.string().optional(),
  author: z.string().optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export type Tokenized = {
  symbol: string;
  raw: string;
  source: string;
  ts: number;
};

export type InterestMetrics = {
  count: number;
  velocity: number;
  diversity: number;
  novelty: number;
  momentum: number;
};

export type SymbolState = {
  ewma: number;
  var: number;
  lastSeen: number;
  recentTs: number[];
  recentSources: string[];
};

export type GlobalState = {
  symbols: Record<string, SymbolState>;
  lastRun: number;
};

export type HotSymbol = {
  symbol: string;
  score: number;
  z: number;
  metrics: InterestMetrics;
};
