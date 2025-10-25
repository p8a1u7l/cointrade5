import { IExchange } from "@repo/exchange-binance";
import cfg from "@repo/core/config";

export type RouteReport = {
  accepted: boolean;
  avgPrice?: number;
  filledQty?: number;
  slipBp?: number;
  latencyMs?: number;
  fills?: Array<{price:number, qty:number, ts:number}>;
  reason?: string;
}

export async function routeOrder(ex: IExchange, params:{
  symbol: string;
  side: "BUY"|"SELL";
  qty: number;
  limitPrice: number;
  maxReprices?: number;           // default 4
  forbidMarket?: boolean;         // NSW High에서 true 가능
}): Promise<RouteReport> {
  const maxReprices = params.maxReprices ?? 4;
  let price = params.limitPrice;
  let cumulativeFills = 0;
  let avgPrice = 0;
  let lastLatency = 0;
  const fills: RouteReport["fills"] = [];

  // 1) post-only limit 시도 + 재가격
  for (let i=0;i<maxReprices;i++) {
    const t0 = Date.now();
    const ack = await ex.place({
      symbol: params.symbol,
      side: params.side,
      type: "LIMIT",
      timeInForce: "GTC",
      price, quantity: params.qty,
      // postOnly: 바이낸스는 maker-only IOC가 없으므로 price 튜닝으로 사실상 구현
    }).catch(e=>{ throw e; });
    lastLatency = Date.now()-t0;
    // 여기에 체결 확인 로직 (사용자 스트림 이벤트로 별도 동기화 가정)
    // 간단화: partial fill 50% 이상이면 accept
    const partial = await waitPartialFill(ex, params.symbol, ack, 120);
    if (partial && partial.ratio >= (cfg.order.maxPartialFillRatio ?? 0.5)) {
      cumulativeFills += partial.filled;
      avgPrice = partial.avgPrice;
      fills.push({price: avgPrice, qty: partial.filled, ts: Date.now()});
      return { accepted:true, avgPrice, filledQty:cumulativeFills, slipBp: estimateSlipBp(avgPrice, price), latencyMs:lastLatency, fills };
    }
    // 재가격
    await delay(80 + i*30);
    const tickSizes = cfg.tickSize as Record<string, number>;
    const tick = tickSizes[params.symbol] ?? 0.1;
    price = reprice(params.side, price, tick);
  }

  // 2) IOC / MARKET 폴백 (금지면 종료)
  if (params.forbidMarket) {
    return { accepted:false, reason:"market forbidden by policy/NSW" };
  }
  const m0 = Date.now();
  const mkt = await ex.place({
    symbol: params.symbol, side: params.side, type: "MARKET", quantity: params.qty
  });
  lastLatency = Date.now()-m0;
  // 체결 결과 수신 후 요약 반환 (간소화)
  const done = await waitFill(ex, params.symbol, mkt, 250);
  if (done) {
    avgPrice = done.avgPrice;
    cumulativeFills = done.filled;
    fills.push({price: avgPrice, qty: done.filled, ts: Date.now()});
    return { accepted:true, avgPrice, filledQty:cumulativeFills, slipBp: estimateSlipBp(avgPrice, price), latencyMs:lastLatency, fills };
  }
  return { accepted:false, reason:"fallback market fill failed" };
}

function reprice(side:"BUY"|"SELL", px:number, tick:number): number {
  // 매수면 가격↑ 한틱, 매도면 가격↓ 한틱
  return side==="BUY" ? (px + tick) : (px - tick);
}
function delay(ms:number){ return new Promise(r=>setTimeout(r, ms)); }
function estimateSlipBp(fill:number, limit:number): number {
  const bp = Math.abs((fill-limit)/limit)*10000;
  return bp;
}

// NOTE: 실제 구현에선 사용자 데이터 스트림으로 체결을 수신한다.
// 여기선 인터페이스 유지 위한 간단 mock(실환경에선 교체).
async function waitPartialFill(ex:IExchange, symbol:string, ack:any, ms=120): Promise<{filled:number, avgPrice:number, ratio:number}|null> {
  await delay(ms);
  return null;
}
async function waitFill(ex:IExchange, symbol:string, ack:any, ms=250): Promise<{filled:number, avgPrice:number}|null> {
  await delay(ms);
  return {filled: ack?.origQty ?? 0, avgPrice: ack?.price ?? 0};
}
