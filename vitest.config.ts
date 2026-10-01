import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^wiki-graph-sdk\/entry-context$/,
        replacement: new URL(
          "./packages/sdk/src/entry-context.ts",
          import.meta.url,
        ).pathname,
      },
      ...[
        ["gc", "gc.ts"],
        ["local-config", "local-config.ts"],
        ["maintenance", "maintenance.ts"],
        ["node-platform", "node-platform.ts"],
        ["planning", "planning.ts"],
        ["runtime-config", "runtime-config.ts"],
        ["wikispine", "wikispine.ts"],
        ["worker", "worker.ts"],
      ].map(([specifier, source]) => ({
        find: new RegExp(`^wiki-graph-sdk/${specifier}$`),
        replacement: new URL(`./packages/sdk/src/${source}`, import.meta.url)
          .pathname,
      })),
      {
        find: /^wiki-graph-sdk$/,
        replacement: new URL("./packages/sdk/src/index.ts", import.meta.url)
          .pathname,
      },
      ...[
        ["gc", "gc.ts"],
        ["worker", "worker.ts"],
        ["platform", "platform.ts"],
      ].map(([specifier, source]) => ({
        find: new RegExp(`^wiki-graph-core/${specifier}$`),
        replacement: new URL(`./packages/core/src/${source}`, import.meta.url)
          .pathname,
      })),
      {
        find: /^wiki-graph-core$/,
        replacement: new URL("./packages/core/src/index.ts", import.meta.url)
          .pathname,
      },
      {
        find: /^wiki-graph-job$/,
        replacement: new URL("./packages/job/src/index.ts", import.meta.url)
          .pathname,
      },
      {
        find: /^wiki-graph-wikimedia$/,
        replacement: new URL(
          "./packages/wikimedia/src/index.ts",
          import.meta.url,
        ).pathname,
      },
    ],
  },
  test: {
    environment: "node",
    setupFiles: [new URL("./test/setup-platform.ts", import.meta.url).pathname],
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
