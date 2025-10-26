import { z } from "zod";

export const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url().or(z.string()),
  timestamp: z.number(),     // ms epoch
  source: z.string(),
  symbols: z.array(z.string()).optional(),
  body: z.string().optional(),
  author: z.string().optional()
});
export type Item = z.infer<typeof ItemSchema>;

export type Tokenized = {
  symbol: string;    // 표준 심볼 (BTC/ETH 등)
  raw: string;       // 매칭 문자열 ($BTC, bitcoin 등)
  source: string;    // 출처
  ts: number;        // 타임스탬프(ms)
};

export type InterestMetrics = {
  count: number;     // 창 내 언급 수
  velocity: number;  // 분당 언급 속도
  diversity: number; // 소스 다양성
  novelty: number;   // 최근 30분 비중(0~1)
  momentum: number;  // 15분 가속도(0~1)
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
  score: number;   // 트렌딩 점수(z)
  z: number;       // 기준선 대비 z-score
  metrics: InterestMetrics;
};
