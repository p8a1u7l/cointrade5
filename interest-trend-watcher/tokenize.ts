import { Item, Tokenized } from "./types.js";

// 심볼 별칭/티커(확장 가능)
const ALIASES: Record<string, string[]> = {
  BTC: ["btc","bitcoin","$btc","btcusdt","xbt"],
  ETH: ["eth","ethereum","$eth","ethusdt"],
  SOL: ["sol","solana","$sol","solusdt"],
  XRP: ["xrp","ripple","$xrp","xrpusdt"],
  ADA: ["ada","cardano","$ada","adausdt"],
  DOGE:["doge","dogecoin","$doge","dogeusdt"],
};
const SYM_FROM_TAG: Record<string,string> = {
  BTC:"BTC", XBT:"BTC", ETH:"ETH", SOL:"SOL", XRP:"XRP", ADA:"ADA", DOGE:"DOGE"
};
function normalize(s:string){ return (s||"").toLowerCase(); }

export function extractSymbols(item: Item): Tokenized[] {
  const text = normalize(`${item.title ?? ""} ${(item.body ?? "")}`);
  const out: Tokenized[] = [];
  const ts = item.timestamp;

  // 1) 소스 태그 우선(CryptoPanic 통화 태그)
  for (const tag of (item.symbols ?? [])) {
    const sym = SYM_FROM_TAG[tag.toUpperCase()];
    if (sym) out.push({ symbol: sym, raw: tag, source: item.source, ts });
  }
  // 2) 본문/제목 별칭/티커 스캔
  for (const [sym, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      if (text.includes(a.toLowerCase())) { out.push({ symbol: sym, raw: a, source: item.source, ts }); break; }
    }
  }
  // 중복 제거 (같은 심볼/소스/타임스탬프)
  const dedup = new Map<string, Tokenized>();
  for (const t of out){ const k = `${t.symbol}:${t.source}:${t.ts}`; if (!dedup.has(k)) dedup.set(k, t); }
  return Array.from(dedup.values());
}
