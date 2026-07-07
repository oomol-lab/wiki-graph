import { copyFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const packageRoot = resolve(import.meta.dirname, "..");
const distDirectoryPath = join(packageRoot, "dist");

copyFileSync(
  join(distDirectoryPath, "index.d.cts"),
  join(distDirectoryPath, "index.d.ts"),
);

writeFileSync(
  join(distDirectoryPath, "index.js"),
  [
    'import { fileURLToPath } from "node:url";',
    'import { resolve } from "node:path";',
    "",
    'globalThis.__WIKIGRAPH_DATA_DIR__ ??= resolve(fileURLToPath(new URL("../data", import.meta.url)));',
    "",
    'import wikiGraphModule from "./index.cjs";',
    "",
    "export const Language = wikiGraphModule.Language;",
    "export const LanguageCode = wikiGraphModule.LanguageCode;",
    "export const SpineDigest = wikiGraphModule.SpineDigest;",
    "export const SpineDigestApp = wikiGraphModule.SpineDigestApp;",
    "export default wikiGraphModule;",
    "",
  ].join("\n"),
);

writeFileSync(
  join(distDirectoryPath, "cli.js"),
  [
    "#!/usr/bin/env node",
    'import { fileURLToPath } from "node:url";',
    'import { resolve } from "node:path";',
    "",
    'globalThis.__WIKIGRAPH_DATA_DIR__ ??= resolve(fileURLToPath(new URL("../data", import.meta.url)));',
    "",
    'import "./cli.cjs";',
    "",
  ].join("\n"),
  {
    mode: 0o755,
  },
);
