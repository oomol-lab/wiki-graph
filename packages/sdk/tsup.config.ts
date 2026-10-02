import { defineConfig } from "tsup";

const CJS_DATA_DIR_BANNER = [
  'globalThis.__WIKIGRAPH_DATA_DIR__ ??= require("path").resolve(__dirname, "data");',
].join("\n");
const ESM_DATA_DIR_BANNER = [
  'import { fileURLToPath as __WIKIGRAPH_FILE_URL_TO_PATH__ } from "url";',
  'import { resolve as __WIKIGRAPH_RESOLVE__ } from "path";',
  'globalThis.__WIKIGRAPH_DATA_DIR__ ??= __WIKIGRAPH_RESOLVE__(__WIKIGRAPH_FILE_URL_TO_PATH__(new URL("./data", import.meta.url)));',
].join("\n");
const ENTRY = {
  archives: "src/archive/index.ts",
  conversions: "src/conversions.ts",
  "default-worker": "src/default-worker.ts",
  embedding: "src/embedding.ts",
  "entry-context": "src/entry-context.ts",
  gc: "src/gc.ts",
  index: "src/index.ts",
  "local-config": "src/local-config.ts",
  llm: "src/llm.ts",
  maintenance: "src/maintenance.ts",
  "node-platform": "src/node-platform.ts",
  planning: "src/planning.ts",
  "runtime-config": "src/runtime-config.ts",
  stage: "src/stage.ts",
  wikispine: "src/wikispine.ts",
  worker: "src/worker.ts",
} as const;
const SHARED_OPTIONS = {
  bundle: true,
  clean: false,
  entry: ENTRY,
  external: ["wiki-graph-core", /^wiki-graph-core\//u] as (string | RegExp)[],
  outDir: "dist",
  platform: "node",
  skipNodeModulesBundle: true,
  sourcemap: true,
  splitting: false,
  target: "node22",
} as const;
const WIKI_GRAPH_CORE_EXTERNAL_PLUGIN = {
  name: "wiki-graph-core-external",
  setup(build: {
    onResolve(
      options: { readonly filter: RegExp },
      callback: (args: { readonly path: string }) => {
        readonly external: boolean;
        readonly path: string;
      },
    ): void;
  }) {
    build.onResolve({ filter: /^wiki-graph-core(?:\/.*)?$/ }, (args) => ({
      external: true,
      path: args.path,
    }));
  },
};

export default defineConfig([
  {
    ...SHARED_OPTIONS,
    banner: { js: CJS_DATA_DIR_BANNER },
    clean: true,
    dts: false,
    esbuildPlugins: [WIKI_GRAPH_CORE_EXTERNAL_PLUGIN],
    format: ["cjs"],
    outExtension: () => ({ js: ".cjs" }),
  },
  {
    ...SHARED_OPTIONS,
    banner: { js: ESM_DATA_DIR_BANNER },
    dts: true,
    esbuildPlugins: [WIKI_GRAPH_CORE_EXTERNAL_PLUGIN],
    format: ["esm"],
  },
]);
