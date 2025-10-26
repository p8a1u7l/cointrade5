import { getJson } from "./http.js";
import { CFG } from "./config.js";
import { Item } from "./types.js";

type CPResp = { results?: any[] };

export async function fetchCryptoPanic(): Promise<Item[]> {
  if (!CFG.cryptopanicToken) return [];
  const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${CFG.cryptopanicToken}&filter=important`;
  const data = await getJson<CPResp>(url);
  const rows = data.results ?? [];
  return rows.map((r:any)=>({
    id: String(r.id),
    title: r.title ?? "",
    url: r.url ?? "",
    timestamp: Date.parse(r.published_at ?? r.created_at ?? new Date().toISOString()),
    source: "cryptopanic",
    author: r.domain ?? "",
    symbols: r.currencies?.map((c:any)=>c.code) ?? [],
    body: r.body ?? undefined
  }));
}
