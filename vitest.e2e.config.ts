import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./test/e2e/global-setup.ts"],
    include: ["test/e2e/**/*.e2e.test.ts"],
    passWithNoTests: false,
    sequence: {
      concurrent: false,
    },
    testTimeout: 120_000,
  },
});
