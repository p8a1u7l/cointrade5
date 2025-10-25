import { buildCandidates } from "@repo/packages/signals/src/buildCandidates";
import { decideWithPolicy } from "./mergePolicy";
import { buildExitPlan, updateStops, type ExitPlan } from "@repo/risk/plan";
import { closePosition, routeOrder } from "@repo/executor/router";
import { callDl } from "@repo/models-dl/client";
import { callNSW } from "@repo/models-llm/nsw";
import { getFeatures, type FeatureSnapshot } from "./features"; // 이미 구현된 피처 빌더
import cfg from "@repo/core/config";
import { IExchange } from "@repo/exchange-binance";

type Side = "LONG" | "SHORT";

interface ActivePosition {
  side: Side;
  qty: number;
  entryPrice: number;
  plan: ExitPlan;
  hitTP1: boolean;
}

const POSITION_EPSILON = 1e-6;

const activePositions = new Map<string, ActivePosition>();
const realizedLedger = new Map<string, number>();

function recordRealized(symbol: string, delta: number): void {
  const current = realizedLedger.get(symbol) ?? 0;
  realizedLedger.set(symbol, current + delta);
}

function computeRealizedPnl(position: ActivePosition, exitPrice: number, quantity: number): number {
  const entry = position.entryPrice;
  const delta = position.side === "LONG" ? exitPrice - entry : entry - exitPrice;
  return delta * quantity;
}

function pickEntryPrice(repPrice: number | undefined, fallback: number): number {
  if (Number.isFinite(repPrice) && repPrice && repPrice > 0) {
    return repPrice;
  }
  return fallback;
}

async function closeAtPrice(
  ex: IExchange,
  symbol: string,
  position: ActivePosition,
  quantity: number,
  orderPrice: number,
  priceHint: number
): Promise<{ realized: number; filled: number } | null> {
  if (!Number.isFinite(quantity) || quantity <= POSITION_EPSILON) {
    return null;
  }
  const orderSide = position.side === "LONG" ? "SELL" : "BUY";
  const price = Number.isFinite(orderPrice) && orderPrice > 0 ? orderPrice : priceHint;
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }
  const report = await closePosition(ex, { symbol, side: orderSide, qty: quantity, price });
  if (!report.accepted) {
    return null;
  }
  const filledQty = Number.isFinite(report.filledQty) && (report.filledQty ?? 0) > 0
    ? (report.filledQty as number)
    : quantity;
  const exitPrice = pickEntryPrice(report.avgPrice, priceHint ?? price);
  const realized = computeRealizedPnl(position, exitPrice, filledQty);
  recordRealized(symbol, realized);
  return { realized, filled: filledQty };
}

function stopTriggered(position: ActivePosition, last: ReturnType<FeatureSnapshot["liveLast"]>): boolean {
  if (position.side === "LONG") {
    return last.low <= position.plan.sl;
  }
  return last.high >= position.plan.sl;
}

function targetHit(position: ActivePosition, target: number | undefined, last: ReturnType<FeatureSnapshot["liveLast"]>): boolean {
  if (!Number.isFinite(target)) {
    return false;
  }
  if (position.side === "LONG") {
    return last.high >= (target as number);
  }
  return last.low <= (target as number);
}

export function getRealizedPnl(symbol?: string): number | Map<string, number> {
  if (typeof symbol === "string") {
    return realizedLedger.get(symbol) ?? 0;
  }
  return new Map(realizedLedger);
}

export async function loop(ex: IExchange, symbol: string) {
  const snapshot: FeatureSnapshot = await getFeatures(symbol);
  const dl = await callDl(symbol, snapshot);
  const nsw = await callNSW(symbol);

  const last = snapshot.liveLast();
  const active = activePositions.get(symbol);

  if (active) {
    const updatedStop = updateStops({
      side: active.side,
      entry: active.entryPrice,
      currentSL: active.plan.sl,
      lastClose: last.close,
      lastHigh: last.high,
      lastLow: last.low,
      atr: snapshot.atr22,
      hitTP1: active.hitTP1,
    });
    active.plan.sl = updatedStop;

    if (stopTriggered(active, last)) {
      const stopPrice = active.plan.sl;
      const priceHint = Number.isFinite(stopPrice) ? stopPrice : last.close;
      const result = await closeAtPrice(ex, symbol, active, active.qty, stopPrice, priceHint);
      if (result) {
        activePositions.delete(symbol);
      }
      return;
    }

    const tp1Reached = !active.hitTP1 && active.plan.tp1 && targetHit(active, active.plan.tp1, last);
    if (tp1Reached) {
      const partialQty = Math.max(1, Math.floor(active.qty / 2));
      const tp1Price = active.plan.tp1 as number;
      const result = await closeAtPrice(ex, symbol, active, partialQty, tp1Price, tp1Price);
      if (result) {
        active.qty = Math.max(0, active.qty - result.filled);
        active.hitTP1 = true;
        active.plan.sl = Math.max(active.plan.sl, active.entryPrice);
      }
    }

    const tp2Target = active.plan.tp2 ?? active.plan.tp1;
    if (targetHit(active, tp2Target, last)) {
      const targetPrice = tp2Target ?? last.close;
      const result = await closeAtPrice(ex, symbol, active, active.qty, targetPrice, targetPrice ?? last.close);
      if (result) {
        activePositions.delete(symbol);
      }
      return;
    }

    if (active.qty <= POSITION_EPSILON) {
      activePositions.delete(symbol);
    }
    return;
  }

  const candidates = buildCandidates(snapshot, dl, nsw);
  const decision = await decideWithPolicy({ features: snapshot, dl, nsw, candidates });

  const best = decision.candidates.find((c) => c.signal !== "NONE" && c.quality >= cfg.qualityThreshold);
  if (!best) return;

  const side: Side = best.signal === "LONG" ? "LONG" : "SHORT";
  const orderSide = side === "LONG" ? "BUY" : "SELL";
  const qty = Math.max(1, Math.floor((snapshot.availableUSDT * (dl.sizeMul ?? 1)) / snapshot.close));
  const entryRef = snapshot.close;
  const plan = buildExitPlan(side, entryRef, best, snapshot);

  const forbidMkt = nsw.policy.forbidMarket;
  const limitPx = orderSide === "BUY" ? entryRef - snapshot.tickSize : entryRef + snapshot.tickSize;

  const report = await routeOrder(ex, {
    symbol,
    side: orderSide,
    qty,
    limitPrice: limitPx,
    maxReprices: 4,
    forbidMarket: forbidMkt,
  });

  if (!report.accepted) {
    return;
  }

  const filledQty = Number.isFinite(report.filledQty) && (report.filledQty ?? 0) > 0
    ? (report.filledQty as number)
    : qty;
  const entryPrice = pickEntryPrice(report.avgPrice, entryRef);
  activePositions.set(symbol, {
    side,
    qty: filledQty,
    entryPrice,
    plan,
    hitTP1: false,
  });
}
