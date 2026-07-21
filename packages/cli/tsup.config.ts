import { defineConfig } from "tsup";

const CJS_DATA_DIR_BANNER = [
  'globalThis.__WIKIGRAPH_DATA_DIR__ ??= require("path").resolve(',
  "  __dirname,",
  '  "data",',
  ");",
].join("\n");
const ESM_DATA_DIR_BANNER = [
  'import { fileURLToPath as __WIKIGRAPH_FILE_URL_TO_PATH__ } from "url";',
  'import { resolve as __WIKIGRAPH_RESOLVE__ } from "path";',
  'globalThis.__WIKIGRAPH_DATA_DIR__ ??= __WIKIGRAPH_RESOLVE__(__WIKIGRAPH_FILE_URL_TO_PATH__(new URL("./data", import.meta.url)));',
].join("\n");
const SHARED_OPTIONS = {
  bundle: true,
  clean: false,
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
      js: ESM_DATA_DIR_BANNER,
    },
    dts: true,
    entry: {
      cli: "src/bin/cli.ts",
      index: "src/index.ts",
      "queue-worker": "src/bin/queue-worker.ts",
    },
    format: ["esm"],
  },
]);
