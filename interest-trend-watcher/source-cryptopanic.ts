import { getJson } from "./http.js";
import { CFG } from "./config.js";
import { Item } from "./types.js";

type CPResp = { results?: any[] };

export async function fetchCryptoPanic(): Promise<Item[]> {
  if (!CFG.cryptopanicToken) return [];
  const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${CFG.cryptopanicToken}&filter=important`;
  const data = await getJson<CPResp>(url);
  const rows = data.results ?? [];
  const items: Item[] = [];
  for (const row of rows) {
    const tsRaw = row?.published_at ?? row?.created_at;
    const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) : NaN;
    if (!Number.isFinite(ts)) continue;

    const url = typeof row?.url === "string" && row.url.length ? row.url : undefined;
    if (!url) continue;

    items.push({
      id: String(row.id ?? `${url}:${ts}`),
      title: typeof row?.title === "string" ? row.title : "",
      url,
      timestamp: ts,
      source: "cryptopanic",
      author: typeof row?.domain === "string" ? row.domain : undefined,
      symbols: Array.isArray(row?.currencies) ? row.currencies.map((c: any) => c?.code).filter(Boolean) : [],
      body: typeof row?.body === "string" && row.body.length ? row.body : undefined,
    });
  }
  return items;
}
