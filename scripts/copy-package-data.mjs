import { cpSync, rmSync } from "fs";
import { resolve } from "path";

const [sourcePath, targetPath, mode] = process.argv.slice(2);

if (sourcePath === undefined || targetPath === undefined) {
  throw new Error(
    "Usage: node scripts/copy-package-data.mjs <source> <target> [--merge]",
  );
}

const resolvedSourcePath = resolve(sourcePath);
const resolvedTargetPath = resolve(targetPath);

if (mode !== "--merge") {
  rmSync(resolvedTargetPath, { force: true, recursive: true });
}
cpSync(resolvedSourcePath, resolvedTargetPath, {
  force: true,
  recursive: true,
});
