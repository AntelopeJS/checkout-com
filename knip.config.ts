import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  entry: [
    "src/test/**/*.test.ts",
    "src/test/antelope.test.ts",
    "test/renewal-probe/index.js",
    ".agents/skills/formal-webhook-acceptance/check.ts",
    ".agents/skills/formal-webhook-acceptance/mutations.ts",
    ".agents/skills/formal-saved-method-chain/check.mts",
  ],
  project: [".agents/skills/formal-saved-method-chain/*.mts"],
});
