import { defineConfig } from "tsup";

const CJS_DATA_DIR_BANNER = [
  'globalThis.__WIKIGRAPH_DATA_DIR__ ??= require("node:path").resolve(',
  "  __dirname,",
  '  "../data",',
  ");",
].join("\n");
const SHARED_OPTIONS = {
  bundle: true,
  outDir: "dist",
  platform: "node",
  skipNodeModulesBundle: true,
  sourcemap: true,
  splitting: false,
  target: "node22",
} as const;

export default defineConfig([
  {
    ...SHARED_OPTIONS,
    banner: {
      js: CJS_DATA_DIR_BANNER,
    },
    clean: true,
    dts: true,
    entry: {
      index: "src/index.ts",
    },
    format: ["cjs"],
    outExtension() {
      return {
        js: ".cjs",
      };
    },
  },
  {
    ...SHARED_OPTIONS,
    banner: {
      js: CJS_DATA_DIR_BANNER,
    },
    clean: false,
    dts: false,
    entry: {
      cli: "src/cli.ts",
    },
    format: ["cjs"],
    outExtension() {
      return {
        js: ".cjs",
      };
    },
  },
]);
