import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,
  clean: true,
  dts: true,
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node22",
});
