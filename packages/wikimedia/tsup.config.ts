import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,
  clean: true,
  dts: true,
  entry: { index: "src/index.ts" },
  external: ["pg", "redis", "wiki-graph-core"],
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node22",
});
