import 'dotenv/config';

export const CFG = {
  cryptopanicToken: process.env.CRYPTOPANIC_TOKEN ?? "",
  outDir: process.env.OUT_DIR ?? "news_interest",
  stateDir: process.env.STATE_DIR ?? ".interest_state",
  windowMin: parseInt(process.env.WINDOW_MIN ?? "180", 10),
  baseDecay: parseFloat(process.env.BASE_EWMA_DECAY ?? "0.2"),
  hotZ: parseFloat(process.env.HOT_Z ?? "2.0"),
  minCount: parseInt(process.env.MIN_COUNT ?? "3", 10),
  minSources: parseInt(process.env.MIN_SOURCES ?? "2", 10),
  http: {
    timeoutMs: parseInt(process.env.TIMEOUT_MS ?? "8000", 10),
    retry: parseInt(process.env.RETRY ?? "3", 10),
    pauseMs: parseInt(process.env.PAUSE_MS ?? "300", 10)
  }
} as const;
