import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";

const packageRoot = resolve(import.meta.dirname, "..");
const coreRoot = join(packageRoot, "packages", "core");
const jobRoot = join(packageRoot, "packages", "job");
const cliRoot = join(packageRoot, "packages", "cli");
const wikimediaRoot = join(packageRoot, "packages", "wikimedia");
const tempRoot = mkdtempSync(join(tmpdir(), "wiki-graph-pack-"));
const cliInstallRoot = join(tempRoot, "cli-install");
const coreInstallRoot = join(tempRoot, "core-install");
const sdkInstallRoot = join(tempRoot, "sdk-install");
const packedTarballs = [];

function readTarballName(packOutput) {
  const packResult = JSON.parse(packOutput);
  const filename = Array.isArray(packResult)
    ? packResult[0]?.filename
    : packResult.filename;

  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(
      "Failed to resolve tarball filename from pnpm pack output.",
    );
  }

  return filename;
}

function packPackage(packageDirectory) {
  const packOutput = execFileSync(
    "pnpm",
    ["pack", "--json", "--pack-destination", tempRoot],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

  const tarballName = readTarballName(packOutput);
  const tarballPath = isAbsolute(tarballName)
    ? tarballName
    : join(tempRoot, tarballName);
  packedTarballs.push(tarballPath);
  return tarballPath;
}

function assertCommonJsExport(cwd, specifier, exportName) {
  execFileSync(
    process.execPath,
    [
      "-e",
      [
        `const mod = require(${JSON.stringify(specifier)});`,
        `if (mod[${JSON.stringify(exportName)}] === undefined || mod[${JSON.stringify(exportName)}] === null) {`,
        `  throw new Error(${JSON.stringify(`CommonJS export ${exportName} is not available from ${specifier}`)});`,
        "}",
      ].join(" "),
    ],
    {
      cwd,
      stdio: "inherit",
    },
  );
}

function assertEsmExport(cwd, specifier, exportName) {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        `const mod = await import(${JSON.stringify(specifier)});`,
        `if (mod[${JSON.stringify(exportName)}] === undefined || mod[${JSON.stringify(exportName)}] === null) {`,
        `  throw new Error(${JSON.stringify(`ESM export ${exportName} is not available from ${specifier}`)});`,
        "}",
      ].join(" "),
    ],
    {
      cwd,
      stdio: "inherit",
    },
  );
}

function assertModuleMissing(cwd, specifier) {
  execFileSync(
    process.execPath,
    [
      "-e",
      [
        "try {",
        `  require.resolve(${JSON.stringify(specifier)});`,
        `  throw new Error(${JSON.stringify(`Module ${specifier} should not be installed`)});`,
        "} catch (error) {",
        "  if (error && error.code === 'MODULE_NOT_FOUND') {",
        "    process.exit(0);",
        "  }",
        "  throw error;",
        "}",
      ].join(" "),
    ],
    {
      cwd,
      stdio: "inherit",
    },
  );
}

function writeInstallWorkspace(cwd, name, overrides = {}) {
  mkdirSync(cwd, { recursive: true });
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name,
      private: true,
    }),
  );
  const overrideLines = Object.entries(overrides).map(
    ([packageName, version]) =>
      `  ${JSON.stringify(packageName)}: ${JSON.stringify(version)}`,
  );
  writeFileSync(
    join(cwd, "pnpm-workspace.yaml"),
    [
      "allowBuilds:",
      "  sqlite3: true",
      ...(overrideLines.length === 0 ? [] : ["overrides:", ...overrideLines]),
      "",
    ].join("\n"),
  );
}

function installTarballs(cwd, tarballPaths) {
  execFileSync("pnpm", ["add", ...tarballPaths], {
    cwd,
    stdio: "inherit",
  });
}

try {
  const jobTarballPath = packPackage(jobRoot);
  const wikimediaTarballPath = packPackage(wikimediaRoot);
  const coreTarballPath = packPackage(coreRoot);
  const cliTarballPath = packPackage(cliRoot);

  writeInstallWorkspace(cliInstallRoot, "wiki-graph-cli-pack-smoke", {
    "wiki-graph-job": `file:${jobTarballPath}`,
    "wiki-graph-wikimedia": `file:${wikimediaTarballPath}`,
  });
  installTarballs(cliInstallRoot, [cliTarballPath]);

  assertModuleMissing(cliInstallRoot, "wiki-graph-core");

  for (const command of ["wg", "wikigraph"]) {
    execFileSync(
      join(cliInstallRoot, "node_modules", ".bin", command),
      ["--help"],
      {
        cwd: cliInstallRoot,
        stdio: "inherit",
      },
    );
    execFileSync(
      join(cliInstallRoot, "node_modules", ".bin", command),
      ["--version"],
      {
        cwd: cliInstallRoot,
        stdio: "inherit",
      },
    );
  }

  writeInstallWorkspace(coreInstallRoot, "wiki-graph-core-pack-smoke", {
    "wiki-graph-job": `file:${jobTarballPath}`,
    "wiki-graph-wikimedia": `file:${wikimediaTarballPath}`,
  });
  installTarballs(coreInstallRoot, [coreTarballPath]);

  assertCommonJsExport(coreInstallRoot, "wiki-graph-core", "WikiGraph");
  assertEsmExport(coreInstallRoot, "wiki-graph-core", "WikiGraph");
  assertCommonJsExport(
    coreInstallRoot,
    "wiki-graph-core/gc",
    "tryRunWikiGraphGc",
  );
  assertEsmExport(coreInstallRoot, "wiki-graph-core/gc", "tryRunWikiGraphGc");
  assertCommonJsExport(
    coreInstallRoot,
    "wiki-graph-core/worker",
    "runBuildJobWorker",
  );
  assertEsmExport(
    coreInstallRoot,
    "wiki-graph-core/worker",
    "runBuildJobWorker",
  );

  writeInstallWorkspace(sdkInstallRoot, "wiki-graph-sdk-pack-smoke", {
    "wiki-graph-job": `file:${jobTarballPath}`,
    "wiki-graph-wikimedia": `file:${wikimediaTarballPath}`,
  });
  installTarballs(sdkInstallRoot, [coreTarballPath, cliTarballPath]);

  assertCommonJsExport(sdkInstallRoot, "wiki-graph", "runWikiGraphCLICaptured");
  assertEsmExport(sdkInstallRoot, "wiki-graph", "runWikiGraphCLICaptured");
  assertCommonJsExport(sdkInstallRoot, "wiki-graph", "Language");
  assertEsmExport(sdkInstallRoot, "wiki-graph", "Language");
} finally {
  for (const tarballPath of packedTarballs) {
    rmSync(tarballPath, { force: true });
  }

  rmSync(tempRoot, { force: true, recursive: true });
}
