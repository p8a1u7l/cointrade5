import { z } from "zod";
import cfg from "@repo/core/config";

const PolicyCandidateSchema = z.object({
  model: z.enum(["BREAKOUT", "MEAN", "EMA50"]),
  side: z.enum(["LONG", "SHORT", "NONE"]),
  reasons: z.array(z.string()).max(10),
});

const PolicyDecisionSchema = z.object({
  allow: z.boolean(),
  quality: z.number().min(0).max(1),
  chosen: z.object({
    model: z.enum(["BREAKOUT", "MEAN", "EMA50"]),
    side: z.enum(["LONG", "SHORT", "NONE"]),
  }),
});

export type PolicyCandidate = z.infer<typeof PolicyCandidateSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export async function callPolicyLLM(input: {
  features: unknown;
  dl: unknown;
  nsw: unknown;
  candidates: PolicyCandidate[];
}): Promise<PolicyDecision> {
  const endpoint = cfg.models?.policy?.endpoint;
  if (!endpoint) {
    throw new Error("Policy LLM endpoint is not configured");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Policy service request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return PolicyDecisionSchema.parse(payload);
}
