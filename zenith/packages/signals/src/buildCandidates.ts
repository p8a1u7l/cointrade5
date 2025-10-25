import { Features } from "@repo/core/schemas";
import { DlOut, NswOut, Candidate } from "./types";
import { avgBody, bodySize, distanceTicks, pickNearestEntryLevel } from "./helpers";
import { calcQualityScore, microFiltersOk } from "./quality";
import cfg from "@repo/core/config";
import { isEngulfing, isHammer, isShootingStar, isDoji, isTweezerTopBottom, isMarubozu } from "@repo/core/patterns";

type Side = "LONG"|"SHORT";

function patternCountAt(features: Features, idx: number, side: Side): {count:number, names:string[]} {
  const n:string[] = [];
  if (isEngulfing(features.candles, idx, side)) n.push(`${side}Engulfing`);
  if (isHammer(features.candles, idx) && side==="LONG") n.push("Hammer");
  if (isShootingStar(features.candles, idx) && side==="SHORT") n.push("ShootingStar");
  if (isDoji(features.candles, idx)) n.push("Doji");
  const tw = isTweezerTopBottom(features.candles, idx);
  if (tw) n.push(`Tweezer-${tw}`);
  if (isMarubozu(features.candles, idx, side)) n.push("Marubozu");
  return { count: n.length, names: n };
}

function rsiOk(features: Features, side: Side): boolean {
  return side === "LONG" ? features.rsi14 > 50 : features.rsi14 < 50;
}

function ofOk(features: Features, side: Side): {ok:boolean, ratio:number, reason:string} {
  const of = features.orderflow;
  const ratio = side === "LONG" ? (of.buy / Math.max(1e-9, of.sell)) : (of.sell / Math.max(1e-9, of.buy));
  const ok = ratio >= (cfg.oflowRatioMin ?? 2.0) || of.bubble;
  return { ok, ratio, reason: `ofRatio=${ratio.toFixed(2)} bubble=${of.bubble}` };
}

function fvgOk(features: Features, side: Side): {ok:boolean, zone?:{from:number,to:number}, reason:string} {
  const fvg = features.fvg?.find(z => z.type === (side==="LONG"?"bullish":"bearish"));
  if (!fvg) return {ok:false, reason:"no FVG"};
  const avg = features.fvgAvgSize ?? 0;
  const ok = fvg.size >= avg * (cfg.fvgMinMultiple ?? 1.2);
  return { ok, zone: ok ? {from: fvg.from, to: fvg.to} : undefined, reason: ok?`fvgSize=${fvg.size.toFixed(2)} ok`: "fvg too small" };
}

function vpNear(features: Features, price: number): {ok:boolean, where:"vah"|"val"|"poc"|"na"} {
  const vp = features.vp;
  const atr = features.atr22;
  const near = (a:number,b:number)=> Math.abs(a-b) <= atr*0.5;
  if (near(price, vp.vah)) return {ok:true, where:"vah"};
  if (near(price, vp.val)) return {ok:true, where:"val"};
  if (near(price, vp.poc)) return {ok:true, where:"poc"};
  return {ok:false, where:"na"};
}

function regimeOk(features: Features, side: Side): boolean {
  const { ema25, ema50, ema100, close } = features;
  if (side==="LONG") return (ema25>ema50 && ema50>ema100 && close>ema25);
  return (ema25<ema50 && ema50<ema100 && close<ema25);
}

function breakBodyStrong(features: Features, above:boolean): boolean {
  const c = features.candles.at(-1)!;
  const body = bodySize(c);
  const ab = avgBody(features.candles, 20);
  const level = above ? features.vp.vah : features.vp.val;
  return (above ? (c.close>level) : (c.close<level)) && (body > ab*1.5);
}

function retraceTo(level:number, features: Features): boolean {
  // 최근 3캔들 내에 level 재터치
  const recent = features.candles.slice(-3);
  return recent.some(c => (c.low<=level && c.high>=level));
}

export function buildCandidates(features: Features, dl: DlOut, nsw: NswOut): Candidate[] {
  const now = features.ts;
  const out: Candidate[] = [];
  const price = features.close;
  const tick = features.tickSize;
  const atr = features.atr22;

  // 공통 마이크로 지표
  const spreadBp = features.micro.spreadBp;
  const latencyMs = features.micro.latencyMs;
  const quoteAgeMs = features.micro.quoteAgeMs;
  const depthBiasLong = features.micro.bidQty10 / Math.max(1, features.micro.askQty10);
  const depthBiasShort = Math.max(1, features.micro.askQty10) / Math.max(1, features.micro.bidQty10);

  // ─────────────────────────────────────────
  // 전략 A: Breakout Momentum
  // ─────────────────────────────────────────
  for (const side of ["LONG","SHORT"] as const) {
    const rOk = regimeOk(features, side);
    const rsi = rsiOk(features, side);
    const of = ofOk(features, side);
    const fvg = fvgOk(features, side);
    const pc = patternCountAt(features, features.candles.length-1, side);
    const above = side==="LONG";
    const strongBreak = breakBodyStrong(features, above);
    const entryLevelOk =
      retraceTo(above?features.vp.vah:features.vp.val, features) ||
      retraceTo(features.ema25, features) ||
      retraceTo(features.ema50, features) ||
      (fvg.zone ? retraceTo((fvg.zone.from+fvg.zone.to)/2, features) : false);
    const vpN = vpNear(features, price);

    if (rOk && rsi && strongBreak && of.ok && entryLevelOk) {
      const q = calcQualityScore({
        regimeOk: rOk,
        ofRatio: of.ratio,
        patternCount: pc.count,
        rsiOk: rsi,
        fvgOk: fvg.ok,
        vpNearOk: vpN.ok,
        ts: now,
        nsw,
      });

      const expectedSlip = dl.slipBp ?? (spreadBp * 0.6);
      const microOk = microFiltersOk({
        side,
        spreadBp, expectedSlipBp: expectedSlip,
        latencyMs, quoteAgeMs,
        depthBias: side==="LONG" ? depthBiasLong : depthBiasShort,
        nsw
      });

      const entryHint = { level: pickNearestEntryLevel(features, fvg.zone) };
      const stopHint = { type: "chandelier" as const, distanceTick: Math.max(2, distanceTicks(atr*cfg.chandelierMult, tick)) };
      const tpPlan = { tp1RR: cfg.rrTargets.model1[0] ?? 2.0, tp2RR: cfg.rrTargets.model1[1] ?? 3.0, target: "next_va" as const };

      out.push({
        signal: microOk && q >= cfg.qualityThreshold ? side : "NONE",
        model: "BREAKOUT",
        quality: q,
        entryHint, stopHint, tpPlan,
        micro: { spreadBp, latencyMs, quoteAgeMs, depthBias: side==="LONG"?depthBiasLong:depthBiasShort },
        reasons: [
          `regime=${rOk}`, `RSI=${features.rsi14.toFixed(1)} ${side==="LONG"?">50":"<50"}`,
          of.reason, fvg.reason, `breakStrong=${strongBreak}`, `entryLevelOk=${entryLevelOk}`, `vpNear=${vpN.where}`,
          `patterns=${pc.names.join(",")||"none"}`
        ],
      });
    }
  }

  // ─────────────────────────────────────────
  // 전략 B: Mean Reversion Fakeout
  // ─────────────────────────────────────────
  // fakeout 정의: VAH/VAL 돌파 후 그 봉 또는 다음 봉이 몸통으로 즉시 VA 내부 복귀.
  const c0 = features.candles.at(-1)!; const c1 = features.candles.at(-2);
  const inVA = (x:number)=> x<=features.vp.vah && x>=features.vp.val;
  const leftVAUp   = c1 && c1.high>features.vp.vah && inVA(c0.close); // 위로 이탈→복귀
  const leftVADown = c1 && c1.low<features.vp.val && inVA(c0.close);  // 아래로 이탈→복귀
  const rsiMid = features.rsi14 >= 45 && features.rsi14 <= 55;

  if (rsiMid && (leftVAUp || leftVADown)) {
    const side: Side = leftVAUp ? "SHORT" : "LONG"; // 복귀 후 중앙(POC) 회귀
    const pc = patternCountAt(features, features.candles.length-1, side);
    // 흡수(Absorption): 이탈점에서 반대 방향 대량체결이 있으나 가격이 진행하지 못함 → of 반전
    const of = ofOk(features, side);
    const fvg = fvgOk(features, side); // 회귀 방향과 FVG 재진입 지점 보조
    const vpN = vpNear(features, features.vp.poc);

    const q = calcQualityScore({
      regimeOk: true, // 평균회귀는 레인지 가정 → 강제 1로 보정
      ofRatio: of.ratio,
      patternCount: pc.count,
      rsiOk: true,    // 45~55 범위면 OK
      fvgOk: !!fvg.ok,
      vpNearOk: vpN.ok,
      ts: now, nsw
    });

    const expectedSlip = dl.slipBp ?? (spreadBp * 0.6);
    const microOk = microFiltersOk({
      side,
      spreadBp, expectedSlipBp: expectedSlip,
      latencyMs, quoteAgeMs,
      depthBias: side==="LONG" ? depthBiasLong : depthBiasShort,
      nsw
    });

    out.push({
      signal: microOk && q >= cfg.qualityThreshold ? side : "NONE",
      model: "MEAN",
      quality: q,
      entryHint: { level: "val" }, // 아래서 복귀→롱이면 VAL/POC 부근, 위서 복귀→숏이면 VAH/POC
      stopHint: { type: "swing", distanceTick: Math.max(2, distanceTicks(atr*1.0, tick)) },
      tpPlan: { tp1RR: 1.0, tp2RR: 1.0, target: "poc" },
      micro: { spreadBp, latencyMs, quoteAgeMs, depthBias: side==="LONG"?depthBiasLong:depthBiasShort },
      reasons: [
        `fakeout=${leftVAUp?"upper→in":"lower→in"}`, `RSI≈50`,
        of.reason, fvg.reason, `target=POC`, `patterns=${pc.names.join(",")||"none"}`
      ]
    });
  }

  // ─────────────────────────────────────────
  // 전략 C: EMA50 Retest (전환+지속)
  // ─────────────────────────────────────────
  // 돌파: 종가가 EMA50을 명확히 넘어섰고(body <= avgBody*4)
  const body = bodySize(c0);
  const ab20 = avgBody(features.candles, 20);
  const crossedUp   = c0.close>features.ema50 && c0.open<features.ema50 && body <= ab20*4;
  const crossedDown = c0.close<features.ema50 && c0.open>features.ema50 && body <= ab20*4;
  const didRetrace = retraceTo(features.ema50, features);
  if ((crossedUp||crossedDown) && didRetrace) {
    const side: Side = crossedUp ? "LONG" : "SHORT";
    const rOk = true; // 전환 전략은 EMA50 기준 전환 가정
    const of = ofOk(features, side);
    const rsi = rsiOk(features, side);
    const pc = patternCountAt(features, features.candles.length-1, side);
    const fvg = fvgOk(features, side); // 있으면 가점
    const vpN = vpNear(features, price);

    const q = calcQualityScore({
      regimeOk: rOk,
      ofRatio: of.ratio,
      patternCount: pc.count,
      rsiOk: rsi,
      fvgOk: fvg.ok,
      vpNearOk: vpN.ok,
      ts: now, nsw
    });

    const expectedSlip = dl.slipBp ?? (spreadBp * 0.6);
    const microOk = microFiltersOk({
      side,
      spreadBp, expectedSlipBp: expectedSlip,
      latencyMs, quoteAgeMs,
      depthBias: side==="LONG" ? depthBiasLong : depthBiasShort,
      nsw
    });

    out.push({
      signal: microOk && q >= cfg.qualityThreshold ? side : "NONE",
      model: "EMA50",
      quality: q,
      entryHint: { level: "ema50" },
      stopHint: { type: "chandelier", distanceTick: Math.max(2, distanceTicks(atr*cfg.chandelierMult, tick)) },
      tpPlan: { tp1RR: cfg.rrTargets.model3[0] ?? 2.0, tp2RR: cfg.rrTargets.model3[1] ?? 2.5, target: "next_va" },
      micro: { spreadBp, latencyMs, quoteAgeMs, depthBias: side==="LONG"?depthBiasLong:depthBiasShort },
      reasons: [
        `cross50=${crossedUp?"up":"down"}`, `retraceTo50=${didRetrace}`,
        of.reason, `RSI=${features.rsi14.toFixed(1)}`, fvg.reason, `vpNear=${vpN.where}`,
        `patterns=${pc.names.join(",")||"none"}`
      ]
    });
  }

  // 빈 후보 방지: 최소 NONE 하나
  if (out.length===0) {
    out.push({
      signal:"NONE", model:"NONE", quality:0,
      entryHint:{level:"ema50"}, stopHint:{type:"swing", distanceTick:0},
      tpPlan:{tp1RR:1, target:"na"},
      micro:{spreadBp, latencyMs, quoteAgeMs, depthBias:1},
      reasons:["no candidate"]
    });
  }
  return out;
}
