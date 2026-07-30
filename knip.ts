import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignoreBinaries: ["bws", "ps"],
  ignoreDependencies: ["lefthook"],
  workspaces: {
    "apps/crawler": {
      ignore: ["src/hooks/helpers.ts"],
    },
  },
};

export default config;
