import cfg from "@repo/core/config";
import { NswOutSchema, type NswOut } from "@repo/packages/signals/src/types";

function resolveEndpoint(): string {
  const endpoint = cfg.models?.nsw?.endpoint;
  if (!endpoint) {
    throw new Error("NSW model endpoint is not configured");
  }
  return endpoint;
}

export async function callNSW(symbol: string): Promise<NswOut> {
  const endpoint = resolveEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ symbol }),
  });

  if (!response.ok) {
    throw new Error(`NSW service request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return NswOutSchema.parse(payload);
}
