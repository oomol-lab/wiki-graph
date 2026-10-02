import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";

const packageRoot = resolve(import.meta.dirname, "..");
const coreRoot = join(packageRoot, "packages", "core");
const jobRoot = join(packageRoot, "packages", "job");
const sdkRoot = join(packageRoot, "packages", "sdk");
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

function assertCommonJsExportMissing(cwd, specifier, exportName) {
  execFileSync(
    process.execPath,
    [
      "-e",
      [
        `const mod = require(${JSON.stringify(specifier)});`,
        `if (mod[${JSON.stringify(exportName)}] !== undefined) {`,
        `  throw new Error(${JSON.stringify(`CommonJS export ${exportName} must not be available from ${specifier}`)});`,
        "}",
      ].join(" "),
    ],
    {
      cwd,
      stdio: "inherit",
    },
  );
}

function assertEsmExportMissing(cwd, specifier, exportName) {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        `const mod = await import(${JSON.stringify(specifier)});`,
        `if (mod[${JSON.stringify(exportName)}] !== undefined) {`,
        `  throw new Error(${JSON.stringify(`ESM export ${exportName} must not be available from ${specifier}`)});`,
        "}",
      ].join(" "),
    ],
    {
      cwd,
      stdio: "inherit",
    },
  );
}

function runNodeScript(cwd, args) {
  execFileSync(process.execPath, args, {
    cwd,
    stdio: "inherit",
  });
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
  const sdkTarballPath = packPackage(sdkRoot);
  const cliTarballPath = packPackage(cliRoot);

  writeInstallWorkspace(cliInstallRoot, "wiki-graph-cli-pack-smoke", {
    "wiki-graph-job": `file:${jobTarballPath}`,
    "wiki-graph-wikimedia": `file:${wikimediaTarballPath}`,
    "wiki-graph-core": `file:${coreTarballPath}`,
    "wiki-graph-sdk": `file:${sdkTarballPath}`,
  });
  installTarballs(cliInstallRoot, [cliTarballPath]);

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
  runNodeScript(cliInstallRoot, [
    "--input-type=module",
    "-e",
    [
      'import { runWikiGraphCLICaptured } from "wiki-graph";',
      'import { existsSync, mkdirSync } from "fs";',
      'import { join } from "path";',
      'const cwd = join(process.cwd(), "programmatic-cli");',
      'const stateDir = join(process.cwd(), "programmatic-cli-state");',
      "mkdirSync(cwd, { recursive: true });",
      "mkdirSync(stateDir, { recursive: true });",
      'const result = await runWikiGraphCLICaptured({ argv: ["wikg://book.wikg", "create"], cwd, stateDir });',
      "if (result.exitCode !== 0) throw new Error(`Programmatic CLI create failed: ${result.stderr}`);",
      'if (!existsSync(join(cwd, "book.wikg"))) throw new Error("Programmatic CLI did not create book.wikg");',
    ].join("\n"),
  ]);

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
    "wiki-graph-core": `file:${coreTarballPath}`,
  });
  installTarballs(sdkInstallRoot, [sdkTarballPath]);

  assertCommonJsExport(sdkInstallRoot, "wiki-graph-sdk", "createWikiGraphSDK");
  assertEsmExport(sdkInstallRoot, "wiki-graph-sdk", "createWikiGraphSDK");
  assertCommonJsExport(sdkInstallRoot, "wiki-graph-sdk", "WikiGraphSDK");
  assertEsmExport(sdkInstallRoot, "wiki-graph-sdk", "WikiGraphSDK");
  assertCommonJsExportMissing(sdkInstallRoot, "wiki-graph-sdk", "WikiGraph");
  assertEsmExportMissing(sdkInstallRoot, "wiki-graph-sdk", "WikiGraph");
  assertCommonJsExport(
    sdkInstallRoot,
    "wiki-graph-sdk/node-platform",
    "NodeFile",
  );
  assertEsmExport(sdkInstallRoot, "wiki-graph-sdk/node-platform", "NodeFile");
  runNodeScript(sdkInstallRoot, [
    "-e",
    [
      'const { createWikiGraphSDK } = require("wiki-graph-sdk");',
      'const { readLocalConfigSection } = require("wiki-graph-sdk/local-config");',
      'const { tryRunWikiGraphGc } = require("wiki-graph-sdk/gc");',
      'const { runBuildJobWorker } = require("wiki-graph-sdk/worker");',
      'const { mkdirSync } = require("fs");',
      'const { join } = require("path");',
      "void (async () => {",
      '  const root = join(process.cwd(), "runtime-smoke-cjs");',
      '  mkdirSync(join(root, "sdk"), { recursive: true });',
      '  const sdk = createWikiGraphSDK({ stateDir: join(root, "sdk") });',
      "  const expectedJobConcurrency = 700000 + process.pid;",
      '  await sdk.config.put("concurrent", "job", expectedJobConcurrency);',
      '  const childConfig = await sdk.run(() => readLocalConfigSection("concurrent"));',
      '  if (childConfig.job !== expectedJobConcurrency) throw new Error("CommonJS local-config did not inherit SDK stateDir");',
      "  sdk.close();",
      '  const report = await tryRunWikiGraphGc({ dryRun: true, stateDir: join(root, "gc") });',
      '  if (report.skipped !== false) throw new Error("CommonJS SDK GC smoke was unexpectedly skipped");',
      "  let executed = false;",
      "  await runBuildJobWorker({",
      "    concurrency: 1,",
      "    executeJob: () => { executed = true; return Promise.resolve(); },",
      "    idleTimeoutMs: 0,",
      '    stateDir: join(root, "worker"),',
      "  });",
      '  if (executed) throw new Error("CommonJS SDK worker smoke unexpectedly found a queued job");',
      "})().catch((error) => { console.error(error); process.exitCode = 1; });",
    ].join("\n"),
  ]);
  runNodeScript(sdkInstallRoot, [
    "--input-type=module",
    "-e",
    [
      'import { createWikiGraphSDK } from "wiki-graph-sdk";',
      'import { tryRunWikiGraphGc } from "wiki-graph-sdk/gc";',
      'import { readLocalConfigSection } from "wiki-graph-sdk/local-config";',
      'import { runBuildJobWorker } from "wiki-graph-sdk/worker";',
      'import { mkdirSync } from "fs";',
      'import { join } from "path";',
      'const root = join(process.cwd(), "runtime-smoke");',
      'mkdirSync(join(root, "sdk"), { recursive: true });',
      'const sdk = createWikiGraphSDK({ stateDir: join(root, "sdk") });',
      "const expectedJobConcurrency = 800000 + process.pid;",
      'await sdk.config.put("concurrent", "job", expectedJobConcurrency);',
      'const childConfig = await sdk.run(() => readLocalConfigSection("concurrent"));',
      'if (childConfig.job !== expectedJobConcurrency) throw new Error("ESM local-config did not inherit SDK stateDir");',
      "sdk.close();",
      'const report = await tryRunWikiGraphGc({ dryRun: true, stateDir: join(root, "gc") });',
      'if (report.skipped !== false) throw new Error("SDK GC smoke was unexpectedly skipped");',
      "let executed = false;",
      "await runBuildJobWorker({",
      "  concurrency: 1,",
      "  executeJob: () => { executed = true; return Promise.resolve(); },",
      "  idleTimeoutMs: 0,",
      '  stateDir: join(root, "worker"),',
      "});",
      'if (executed) throw new Error("SDK worker smoke unexpectedly found a queued job");',
    ].join("\n"),
  ]);
} finally {
  for (const tarballPath of packedTarballs) {
    rmSync(tarballPath, { force: true });
  }

  rmSync(tempRoot, { force: true, recursive: true });
}
