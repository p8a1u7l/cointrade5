import { clamp } from "@repo/core/math";
import { sessionOf } from "@repo/core/micro";
import { NswOut } from "./types";
import cfg from "@repo/core/config"; // engine.yml 로딩 래퍼

export function calcQualityScore(params: {
  regimeOk: boolean;
  ofRatio: number;           // 2.0 이상이면 강우위로 간주
  patternCount: number;      // 0,1,2,3+
  rsiOk: boolean;
  fvgOk: boolean;
  vpNearOk: boolean;         // ATR*0.5 이내
  ts: number;                // ms UTC
  nsw: NswOut;
}): number {
  const { regimeOk, ofRatio, patternCount, rsiOk, fvgOk, vpNearOk, ts, nsw } = params;

  const regime = regimeOk ? 1 : 0;
  const ofScore =
    ofRatio >= 3.0 ? 1 : ofRatio >= 2.0 ? 0.8 : ofRatio >= 1.5 ? 0.5 : 0.0;
  const patScore = patternCount >= 3 ? 1 : patternCount === 2 ? 0.66 : patternCount === 1 ? 0.33 : 0;

  let base =
      0.30 * regime +
      0.25 * ofScore +
      0.15 * patScore +
      0.10 * (rsiOk ? 1 : 0) +
      0.10 * (fvgOk ? 1 : 0) +
      0.10 * (vpNearOk ? 1 : 0);

  const sess = sessionOf(ts);
  const weights = cfg.sessions.weights; // {ASIA:0.8,...}
  base *= (weights[sess] ?? 1);

  if (nsw.grade === "High") base *= 0.8;
  if (nsw.grade === "Critical") base *= 0.7;

  return clamp(base, 0, 1);
}

export function microFiltersOk(m: {
  side: "LONG"|"SHORT";
  spreadBp: number;
  expectedSlipBp: number;
  latencyMs: number;
  quoteAgeMs: number;
  depthBias: number; // bid/ask for LONG, ask/bid for SHORT 등 호출측에서 맞춤
  nsw: NswOut;
}): boolean {
  const caps = { ...cfg.microFilters } as typeof cfg.microFilters & { slippageBp: number };
  if (m.nsw.grade === "High") {
    caps.spreadBp = Math.min(caps.spreadBp, cfg.nswCaps?.spreadHigh ?? 2.0);
    caps.slippageBp = Math.min(caps.slippageBp, cfg.nswCaps?.slipHigh ?? 2.5);
  }
  const depthThreshold = m.side === "LONG"
    ? (caps.depthBiasLong ?? 0.8)
    : (caps.depthBiasShort ?? caps.depthBiasLong ?? 0.8);
  return (
    m.spreadBp <= caps.spreadBp &&
    m.expectedSlipBp <= caps.slippageBp &&
    m.latencyMs <= caps.latencyMs &&
    m.quoteAgeMs <= caps.quoteAgeMs &&
    m.depthBias >= depthThreshold // 호출 측에서 방향에 맞게 세팅
  );
}
