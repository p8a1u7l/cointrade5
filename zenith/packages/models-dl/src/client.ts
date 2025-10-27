import cfg from "@repo/core/config";
import { DlOutSchema, type DlOut } from "@repo/packages/signals/src/types";
import type { Features } from "@repo/core/schemas";

function resolveEndpoint(): string {
  const endpoint = cfg.models?.dl?.endpoint;
  if (!endpoint) {
    throw new Error("DL model endpoint is not configured");
  }
  return endpoint;
}

function buildPayload(symbol: string, features: Features) {
  return {
    symbol,
    ts: features.ts,
    features,
  };
}

export async function callDl(symbol: string, features: Features): Promise<DlOut> {
  const endpoint = resolveEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(buildPayload(symbol, features)),
  });

  if (!response.ok) {
    throw new Error(`DL service request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return DlOutSchema.parse(payload);
}
