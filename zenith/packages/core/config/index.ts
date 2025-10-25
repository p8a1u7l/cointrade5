// 간단 보장 래퍼 (실프로덕션에선 yaml 로더 이미 있을 것)
export default {
  qualityThreshold: 0.70,
  chandelierMult: 3.0,
  oflowRatioMin: 2.0,
  fvgMinMultiple: 1.2,
  rrTargets: {
    model1: [2.0, 3.0],
    model2: [1.0],
    model3: [2.0, 2.5],
  },
  microFilters: { spreadBp: 2.5, slippageBp: 3.0, latencyMs:150, quoteAgeMs:200, depthBiasLong:0.8, depthBiasShort:0.8 },
  sessions: { weights: { ASIA:0.8, LONDON:1.0, NY:1.2, BRIDGE:0.9 } },
  nswCaps: { spreadHigh: 2.0, slipHigh: 2.5 },
  tickSize: { BTCUSDT: 0.1, ETHUSDT: 0.01 },
  order: { maxPartialFillRatio: 0.5 },
  data: {
    featureServiceUrl: process.env.FEATURE_SERVICE_URL ?? "http://localhost:4000/api/features",
  },
  models: {
    dl: { endpoint: process.env.DL_SERVICE_URL ?? "http://localhost:4500/api/dl" },
    nsw: { endpoint: process.env.NSW_SERVICE_URL ?? "http://localhost:4501/api/nsw" },
    policy: { endpoint: process.env.POLICY_SERVICE_URL ?? "http://localhost:4502/api/policy" },
  },
};
