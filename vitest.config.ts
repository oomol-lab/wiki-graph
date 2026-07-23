import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "wiki-graph-core/gc": new URL(
        "./packages/core/src/gc.ts",
        import.meta.url,
      ).pathname,
      "wiki-graph-core/worker": new URL(
        "./packages/core/src/worker.ts",
        import.meta.url,
      ).pathname,
      "wiki-graph-core": new URL(
        "./packages/core/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/cli/src/cli.ts",
        "packages/*/src/index.ts",
        "packages/*/src/**/index.ts",
        "packages/*/src/**/*.test.ts",
      ],
    },
  },
});
