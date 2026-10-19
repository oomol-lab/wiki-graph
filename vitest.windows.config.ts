import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

export const windowsRegressionFiles = [
  "test/core/runtime/platform/node-platform.test.ts",
  "test/core/storage/wikg/opaque-file-adapter.test.ts",
  "test/core/storage/wikg/wiki-graph-archive-file.test.ts",
  "test/core/storage/wikg/archive-coordination.test.ts",
  "packages/sdk/src/full-regression/delivery.full-regression.test.ts",
];

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [...windowsRegressionFiles, "test/windows/**/*.test.ts"],
    passWithNoTests: false,
    maxWorkers: 1,
  },
});
