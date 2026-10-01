import { defineConfig } from "tsup";

const SHARED_OPTIONS = {
  clean: false,
  outDir: "dist",
  platform: "neutral",
  skipNodeModulesBundle: true,
  sourcemap: true,
  splitting: false,
  target: "es2022",
  tsconfig: "tsconfig.portable.json",
} as const;
const ENTRY = {
  gc: "src/gc.ts",
  index: "src/index.ts",
  worker: "src/worker.ts",
} as const;

export default defineConfig([
  {
    ...SHARED_OPTIONS,
    bundle: true,
    clean: true,
    dts: false,
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
    dts: {
      entry: ENTRY,
    },
    entry: ["src/**/*.ts", "!src/**/*.test.ts"],
    format: ["esm"],
  },
]);
