import { cpSync, rmSync } from "fs";
import { resolve } from "path";

const [sourcePath, targetPath] = process.argv.slice(2);

if (sourcePath === undefined || targetPath === undefined) {
  throw new Error(
    "Usage: node scripts/copy-package-data.mjs <source> <target>",
  );
}

const resolvedSourcePath = resolve(sourcePath);
const resolvedTargetPath = resolve(targetPath);

rmSync(resolvedTargetPath, { force: true, recursive: true });
cpSync(resolvedSourcePath, resolvedTargetPath, { recursive: true });
