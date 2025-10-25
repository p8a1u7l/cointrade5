import cfg from "@repo/core/config";
import { Features as FeaturesSchema } from "@repo/core/schemas";
import type { Features as FeaturesType } from "@repo/core/schemas";

export type LiveLast = { close: number; high: number; low: number };
export type FeatureSnapshot = FeaturesType & { liveLast: () => LiveLast };

function resolveEndpoint(symbol: string): string {
  const base = cfg.data?.featureServiceUrl;
  if (!base) {
    throw new Error("feature service URL is not configured");
  }
  if (base.includes("{symbol}")) {
    return base.replace("{symbol}", symbol);
  }
  try {
    const url = new URL(base);
    if (!url.searchParams.has("symbol")) {
      url.searchParams.set("symbol", symbol);
    }
    return url.toString();
  } catch (_err) {
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}symbol=${encodeURIComponent(symbol)}`;
  }
}

function toLiveLast(payload: any, fallback: FeaturesType): LiveLast {
  const source = payload?.live ?? payload?.tick ?? payload;
  const close = Number(source?.close ?? fallback.close);
  const high = Number(source?.high ?? source?.close ?? fallback.close);
  const low = Number(source?.low ?? source?.close ?? fallback.close);
  return {
    close: Number.isFinite(close) ? close : fallback.close,
    high: Number.isFinite(high) ? high : fallback.close,
    low: Number.isFinite(low) ? low : fallback.close,
  };
}

export async function getFeatures(symbol: string): Promise<FeatureSnapshot> {
  const endpoint = resolveEndpoint(symbol);
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`failed to load features for ${symbol}: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const base = FeaturesSchema.parse(payload) as FeaturesType;
  const snapshot: FeatureSnapshot = Object.assign({}, base, {
    liveLast: () => toLiveLast(payload, base),
  });
  return snapshot;
}
