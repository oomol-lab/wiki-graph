import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const packageRoot = resolve(import.meta.dirname, "..");
const tempRoot = mkdtempSync(join(tmpdir(), "wiki-graph-pack-"));
let tarballName;

function readTarballName(packOutput) {
  const packResult = JSON.parse(packOutput);
  const filename = packResult[0]?.filename;

  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("Failed to resolve tarball filename from npm pack output.");
  }

  return filename;
}

try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json"],
    {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

  tarballName = readTarballName(packOutput);

  writeFileSync(
    join(tempRoot, "package.json"),
    JSON.stringify({ name: "wiki-graph-pack-smoke", private: true }),
  );

  const tarballPath = join(packageRoot, tarballName);

  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath],
    {
      cwd: tempRoot,
      stdio: "inherit",
    },
  );

  execFileSync(
    process.execPath,
    [
      "-e",
      [
        'const mod = require("wiki-graph");',
        "if (mod.Language === undefined || mod.Language === null) {",
        '  throw new Error("CommonJS export Language is not available");',
        "}",
      ].join(" "),
    ],
    {
      cwd: tempRoot,
      stdio: "inherit",
    },
  );

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        'const mod = await import("wiki-graph");',
        "if (mod.Language === undefined || mod.Language === null) {",
        '  throw new Error("ESM export Language is not available");',
        "}",
        "process.exit(0);",
      ].join(" "),
    ],
    {
      cwd: tempRoot,
      stdio: "inherit",
    },
  );

  for (const command of ["wg", "wikigraph"]) {
    execFileSync(join(tempRoot, "node_modules", ".bin", command), ["--help"], {
      cwd: tempRoot,
      stdio: "inherit",
    });
  }
} finally {
  if (tarballName !== undefined) {
    rmSync(join(packageRoot, tarballName), { force: true });
  }

  rmSync(tempRoot, { force: true, recursive: true });
}
