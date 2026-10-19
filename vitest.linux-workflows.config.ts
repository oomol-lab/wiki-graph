import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      "packages/sdk/src/full-regression/library-search-pagination.full-regression.test.ts",
      "test/full-regression/cli/archive/source-ingestion.full-regression.test.ts",
    ],
    passWithNoTests: false,
  },
});
