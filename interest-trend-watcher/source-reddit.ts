import { CFG } from "./config.js";
import { getJson } from "./http.js";
import { Item } from "./types.js";

type RedditListing = {
  data?: {
    children?: Array<{
      data?: any;
    }>;
  };
};

const SORT_WHITELIST = new Set(["new", "hot", "rising", "top"]);

export async function fetchReddit(): Promise<Item[]> {
  const subs = CFG.reddit.subs;
  if (!subs.length) return [];

  const sort = SORT_WHITELIST.has(CFG.reddit.sort) ? CFG.reddit.sort : "new";
  const items: Item[] = [];
  const fallbackSubs = new Set<string>();

  for (const sub of subs) {
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}.json?limit=${CFG.reddit.limit}&raw_json=1`;
    try {
      const listing = await getJson<RedditListing>(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": CFG.reddit.userAgent,
          Referer: "https://www.reddit.com/",
        },
      });
      const posts = listing?.data?.children ?? [];
      for (const child of posts) {
        const data = child?.data;
        if (!data) continue;
        if (data.stickied) continue;
        if (typeof data.created_utc !== "number") continue;
        const ts = Math.round(data.created_utc * 1000);
        const permalink = typeof data.permalink === "string" ? data.permalink : "";
        const targetUrl = typeof data.url === "string" && data.url.startsWith("http")
          ? data.url
          : (permalink ? `https://reddit.com${permalink}` : undefined);
        if (!targetUrl) continue;
        const flairText = typeof data.link_flair_text === "string" && data.link_flair_text.length
          ? [data.link_flair_text]
          : undefined;
        const richFlair = Array.isArray(data.link_flair_richtext)
          ? data.link_flair_richtext
              .map((v: any) => (v && typeof v.t === "string" ? v.t : undefined))
              .filter(Boolean)
          : [];
        const symbolTags = richFlair.length ? richFlair : flairText;

        const title = typeof data.title === "string" ? data.title : "";
        if (!title) continue;

        items.push({
          id: `reddit:${data.id ?? `${sub}-${ts}`}`,
          title,
          url: targetUrl,
          timestamp: ts,
          source: `reddit:${sub}`,
          symbols: symbolTags && symbolTags.length ? symbolTags : undefined,
          body: typeof data.selftext === "string" && data.selftext.trim().length ? data.selftext : undefined,
          author: typeof data.author === "string" && data.author.length ? data.author : undefined,
        });
      }
    } catch (error: any) {
      const reason = error?.response?.status ? `${error.response.status} ${error.response.statusText ?? ""}`.trim() : (error?.message ?? String(error));
      console.warn(`[reddit] fetch failed for r/${sub}: ${reason}`);
      if (error?.response?.status === 403) {
        fallbackSubs.add(sub.toLowerCase());
      }
    }

    if (CFG.reddit.pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, CFG.reddit.pauseMs));
    }
  }

  if (fallbackSubs.size && CFG.cryptopanicToken) {
    const fallback = await fetchCryptoPanicReddit(Array.from(fallbackSubs));
    items.push(...fallback);
  }

  return items;
}

type CryptoPanicResp = { results?: any[] };

async function fetchCryptoPanicReddit(subs: string[]): Promise<Item[]> {
  const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${CFG.cryptopanicToken}&filter=reddit`;
  try {
    const data = await getJson<CryptoPanicResp>(url);
    const rows = data.results ?? [];
    const wanted = subs.map((s) => s.toLowerCase());
    return rows
      .filter((row: any) => {
        if (!wanted.length) return true;
        const sr = row?.metadata?.subreddit ?? row?.metadata?.community ?? row?.metadata?.channel;
        if (typeof sr === "string") {
          return wanted.includes(sr.toLowerCase());
        }
        return true;
      })
      .map((r: any) => {
        const tsRaw = r?.published_at ?? r?.created_at;
        const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) : NaN;
        if (!Number.isFinite(ts)) return undefined;
        const subreddit = typeof r?.metadata?.subreddit === "string" ? r.metadata.subreddit : undefined;
        const url = typeof r?.url === "string" && r.url.startsWith("http") ? r.url : undefined;
        const title = typeof r?.title === "string" ? r.title : undefined;
        if (!url || !title) return undefined;
        const body = typeof r?.body === "string" && r.body.length ? r.body : (typeof r?.metadata?.body === "string" && r.metadata.body.length ? r.metadata.body : undefined);
        const author = typeof r?.metadata?.author === "string" && r.metadata.author.length
          ? r.metadata.author
          : (typeof r?.author === "string" && r.author.length ? r.author : undefined);
        return {
          id: `reddit:cp:${r.id ?? `${url}:${ts}`}`,
          title,
          url,
          timestamp: ts,
          source: `reddit:${subreddit ?? r.source ?? "cryptopanic"}`,
          symbols: Array.isArray(r?.currencies) ? r.currencies.map((c: any) => c?.code).filter(Boolean) : undefined,
          body,
          author,
        } as Item;
      })
      .filter((v): v is Item => Boolean(v));
  } catch (error) {
    console.warn(`[reddit] CryptoPanic fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
