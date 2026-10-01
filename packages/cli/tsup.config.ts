import { defineConfig } from "tsup";

const CJS_DATA_DIR_BANNER = [
  "globalThis.__WIKIGRAPH_CLI_DIST_DIR__ ??= __dirname;",
  'globalThis.__WIKIGRAPH_DATA_DIR__ ??= require("path").resolve(',
  "  __dirname,",
  '  "data",',
  ");",
].join("\n");
const ESM_DATA_DIR_BANNER = [
  'import { fileURLToPath as __WIKIGRAPH_FILE_URL_TO_PATH__ } from "url";',
  'import { resolve as __WIKIGRAPH_RESOLVE__ } from "path";',
  'globalThis.__WIKIGRAPH_CLI_DIST_DIR__ ??= __WIKIGRAPH_RESOLVE__(__WIKIGRAPH_FILE_URL_TO_PATH__(new URL(".", import.meta.url)));',
  'globalThis.__WIKIGRAPH_DATA_DIR__ ??= __WIKIGRAPH_RESOLVE__(__WIKIGRAPH_FILE_URL_TO_PATH__(new URL("./data", import.meta.url)));',
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
const INDEX_EXTERNAL = [
  "wiki-graph-sdk",
  "wiki-graph-sdk/gc",
  "wiki-graph-sdk/worker",
];
const WIKI_GRAPH_SDK_EXTERNAL_PLUGIN = {
  name: "wiki-graph-sdk-external",
  setup(build: {
    onResolve(
      options: { readonly filter: RegExp },
      callback: (args: { readonly path: string }) => {
        readonly external: boolean;
        readonly path: string;
      },
    ): void;
  }) {
    build.onResolve({ filter: /^wiki-graph-sdk(?:\/.*)?$/ }, (args) => ({
      external: true,
      path: args.path,
    }));
  },
};

export default defineConfig([
  {
    ...SHARED_OPTIONS,
    banner: {
      js: CJS_DATA_DIR_BANNER,
    },
    bundle: true,
    clean: true,
    dts: false,
    entry: {
      index: "src/index.ts",
    },
    esbuildPlugins: [WIKI_GRAPH_SDK_EXTERNAL_PLUGIN],
    external: INDEX_EXTERNAL,
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
    bundle: true,
    dts: false,
    entry: {
      cli: "src/bin/cli.ts",
      "gc-worker": "src/bin/gc-worker.ts",
      "queue-worker": "src/bin/queue-worker.ts",
    },
    format: ["esm"],
    minify: true,
  },
  {
    ...SHARED_OPTIONS,
    banner: {
      js: ESM_DATA_DIR_BANNER,
    },
    bundle: true,
    dts: true,
    entry: {
      index: "src/index.ts",
    },
    esbuildPlugins: [WIKI_GRAPH_SDK_EXTERNAL_PLUGIN],
    external: INDEX_EXTERNAL,
    format: ["esm"],
  },
]);
