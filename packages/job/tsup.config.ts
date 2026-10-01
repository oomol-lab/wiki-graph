import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,
  clean: true,
  dts: true,
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "neutral",
  sourcemap: true,
  splitting: false,
  target: "es2022",
  tsconfig: "tsconfig.portable.json",
});
