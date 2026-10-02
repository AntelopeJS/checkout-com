import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  entry: [
    "src/test/**/*.test.ts",
    "src/test/antelope.test.ts",
    "test/renewal-probe/index.js",
  ],
  ignoreBinaries: ["ajs"],
});
