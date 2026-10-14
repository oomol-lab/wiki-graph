import { mergeConfig } from "vitest/config";

import baseConfig from "./vitest.config.js";

export default mergeConfig(baseConfig, {
  test: {
    exclude: ["test/e2e/**", "**/*.full-regression.test.ts"],
  },
});
