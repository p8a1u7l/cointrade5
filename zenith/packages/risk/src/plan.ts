import { Candidate } from "@repo/packages/signals/src/types";
import { Features } from "@repo/core/schemas";
import cfg from "@repo/core/config";

export type ExitPlan = {
  sl: number;
  tp1?: number;
  tp2?: number;
  trail: {
    mode: "chandelier"|"prev_candle";
    atrMult: number;           // chandelier 파라미터
    moveToBEOnTP1: boolean;    // TP1 체결 후 BE 이동
  }
}

export function buildExitPlan(side:"LONG"|"SHORT", entry:number, c: Candidate, f: Features): ExitPlan {
  const atr = f.atr22;
  const tick = f.tickSize;
  const distTick = Math.max(c.stopHint.distanceTick, Math.round(atr*cfg.chandelierMult/tick));
  const dist = distTick * tick;

  let sl = side==="LONG" ? entry - dist : entry + dist;

  let tp1: number|undefined;
  let tp2: number|undefined;
  const rr1 = c.tpPlan.tp1RR ?? 2.0;
  const rr2 = c.tpPlan.tp2RR ?? undefined;

  if (rr1) {
    const risk = Math.abs(entry - sl);
    tp1 = side==="LONG" ? entry + risk*rr1 : entry - risk*rr1;
  }
  if (rr2) {
    const risk = Math.abs(entry - sl);
    tp2 = side==="LONG" ? entry + risk*rr2 : entry - risk*rr2;
  }

  return {
    sl, tp1, tp2,
    trail: { mode: "chandelier", atrMult: cfg.chandelierMult, moveToBEOnTP1: true }
  };
}

// 트레일링/BE 이동 업데이트
export function updateStops(params:{
  side:"LONG"|"SHORT",
  entry:number,
  currentSL:number,
  lastClose:number,
  lastHigh:number,
  lastLow:number,
  atr:number,
  hitTP1:boolean
}): number {
  let { side, entry, currentSL, lastClose, lastHigh, lastLow, atr, hitTP1 } = params;
  // BE 이동
  if (hitTP1 && ((side==="LONG" && currentSL<entry) || (side==="SHORT" && currentSL>entry))) {
    currentSL = entry;
  }
  // Chandelier 트레일
  const chand = side==="LONG" ? (lastHigh - atr*cfg.chandelierMult) : (lastLow + atr*cfg.chandelierMult);
  if (side==="LONG") {
    currentSL = Math.max(currentSL, chand);
  } else {
    currentSL = Math.min(currentSL, chand);
  }
  return currentSL;
}
