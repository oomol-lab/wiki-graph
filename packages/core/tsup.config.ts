import { defineConfig } from "tsup";

const CJS_DATA_DIR_BANNER = [
  'globalThis.__WIKIGRAPH_DATA_DIR__ ??= require("path").resolve(',
  "  __dirname,",
  '  "../data",',
  ");",
].join("\n");
const SHARED_OPTIONS = {
  clean: false,
  outDir: "dist",
  platform: "node",
  skipNodeModulesBundle: true,
  sourcemap: true,
  splitting: false,
  target: "node22",
} as const;
const ENTRY = {
  gc: "src/gc.ts",
  index: "src/index.ts",
  worker: "src/worker.ts",
} as const;

export default defineConfig([
  {
    ...SHARED_OPTIONS,
    banner: {
      js: CJS_DATA_DIR_BANNER,
    },
    bundle: true,
    clean: true,
    dts: true,
    entry: ENTRY,
    format: ["cjs"],
    outExtension() {
      return {
        js: ".cjs",
      };
    },
  },
  {
    ...SHARED_OPTIONS,
    bundle: false,
    dts: true,
    entry: ["src/**/*.ts"],
    format: ["esm"],
  },
]);
