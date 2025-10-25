import { buildCandidates } from "@repo/packages/signals/src/buildCandidates";
import { decideWithPolicy } from "./mergePolicy";
import { buildExitPlan, updateStops } from "@repo/risk/plan";
import { routeOrder } from "@repo/executor/router";
import { callDl } from "@repo/models-dl/client";
import { callNSW } from "@repo/models-llm/nsw";
import { getFeatures, type FeatureSnapshot } from "./features"; // 이미 구현된 피처 빌더
import cfg from "@repo/core/config";
import { IExchange } from "@repo/exchange-binance";

export async function loop(ex:IExchange, symbol:string){
  const f: FeatureSnapshot = await getFeatures(symbol);
  const dl = await callDl(symbol, f);
  const nsw = await callNSW(symbol);

  const candidates = buildCandidates(f, dl, nsw);
  const decision = await decideWithPolicy({ features:f, dl, nsw, candidates });

  const best = decision.candidates.find(c=>c.signal!=="NONE" && c.quality>=cfg.qualityThreshold);
  if (!best) return;

  // 사이즈 및 가격
  const side = best.signal==="LONG" ? "BUY" : "SELL";
  const qty = Math.max(1, Math.floor((f.availableUSDT * (dl.sizeMul ?? 1)) / f.close));
  const entry = f.close; // 시장근처
  const plan = buildExitPlan(best.signal as "LONG"|"SHORT", entry, best, f);

  const forbidMkt = nsw.policy.forbidMarket;
  const limitPx = side==="BUY" ? (entry - f.tickSize) : (entry + f.tickSize);

  const rep = await routeOrder(ex, {
    symbol, side, qty, limitPrice: limitPx,
    maxReprices: 4, forbidMarket: forbidMkt
  });

  if (!rep.accepted) return;

  // 포지션 관리(1초 주기 가정)
  let hitTP1 = false;
  setInterval(()=>{
    // 실시간 가격/고저 업데이트는 외부에서 주입된다고 가정
    const last = f.liveLast();
    if (!hitTP1 && plan.tp1 && ((best.signal==="LONG" && last.close>=plan.tp1) || (best.signal==="SHORT" && last.close<=plan.tp1))) {
      // 부분청산 50% & BE 이동
      // exchange.reduceOnly...
      hitTP1 = true;
    }
    const newSL = updateStops({
      side: best.signal as "LONG"|"SHORT",
      entry, currentSL: plan.sl,
      lastClose: last.close, lastHigh: last.high, lastLow: last.low,
      atr: f.atr22, hitTP1
    });
    plan.sl = newSL;
  }, 1000);
}
