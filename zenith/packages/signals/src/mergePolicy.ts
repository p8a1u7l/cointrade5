import { Candidate, Decision } from "@repo/packages/signals/src/types";
import { PolicyDecision, callPolicyLLM } from "@repo/models-llm/policy";
import cfg from "@repo/core/config";

export async function decideWithPolicy(input:{
  features:any, dl:any, nsw:any, candidates: Candidate[]
}): Promise<Decision> {
  // 후보는 신뢰도 높은 순(quality desc)으로 정렬해서 전달
  const sorted = [...input.candidates].sort((a,b)=>b.quality-a.quality).slice(0,5);
  const res: PolicyDecision = await callPolicyLLM({
    features: input.features,
    dl: input.dl,
    nsw: input.nsw,
    candidates: sorted.map(c => ({
      model: c.model==="NONE" ? "BREAKOUT" : c.model, // NONE 보호
      side: c.signal==="NONE" ? "NONE" : (c.signal==="LONG"?"LONG":"SHORT"),
      reasons: c.reasons.slice(0,6),
    }))
  });

  // LLM 정책 반영: allow=false → 전체 NONE
  let final: Candidate[] = sorted;
  if (!res.allow || sorted.length === 0) {
    const fallback = sorted[0] ?? input.candidates[0];
    final = fallback ? [{
      ...fallback,
      signal: "NONE",
      model: "NONE",
      quality: 0,
      reasons: [...fallback.reasons, "policy: disallow"]
    }] : [];
  } else {
    // 선택된 후보만 우선 반영, 나머지는 보조
    const pick = sorted.find(c => c.model === res.chosen.model && (c.signal === "LONG" || c.signal === "SHORT"));
    if (pick) {
      pick.quality = Math.min(pick.quality, res.quality); // 정책 품질 상한 반영
      // 정책 제약(스프레드 캡/마켓 금지/사이즈 계수)은 executor/risk에서 재적용
    }
  }

  return {
    candidates: final,
    meta: {
      session: input.features.session,
      regime: input.features.regime,
      qualityThreshold: cfg.qualityThreshold
    }
  };
}
