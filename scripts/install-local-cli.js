import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";
import { pathToFileURL } from "url";

const workspaceRoot = resolve(import.meta.dirname, "..");
export const localCliPackageRoots = [
  "job",
  "wikimedia",
  "core",
  "sdk",
  "cli",
].map((name) => join(workspaceRoot, "packages", name));

function createNpmEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toLowerCase().startsWith("npm_config_"),
    ),
  );
}

/** @param {string} packOutput @param {string} packRoot */
function readTarballPath(packOutput, packRoot) {
  const packResult = JSON.parse(packOutput);
  const filename = Array.isArray(packResult)
    ? packResult[0]?.filename
    : packResult.filename;

  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(
      "Failed to resolve tarball filename from pnpm pack output.",
    );
  }

  return isAbsolute(filename) ? filename : join(packRoot, filename);
}

/** @param {string} packageRoot @param {string} packRoot */
function packPackage(packageRoot, packRoot) {
  const packOutput = execFileSync(
    "pnpm",
    ["pack", "--json", "--pack-destination", packRoot],
    {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return readTarballPath(packOutput, packRoot);
}

/** @param {readonly string[]} packageRoots */
export function assertWorkspaceDependencyClosure(packageRoots) {
  const manifests = packageRoots.map((packageRoot) => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    );
    if (typeof manifest.name !== "string") {
      throw new Error(`Invalid package manifest: ${packageRoot}`);
    }
    return { manifest, packageRoot };
  });
  const selectedNames = new Set(manifests.map(({ manifest }) => manifest.name));

  for (const { manifest, packageRoot } of manifests) {
    for (const field of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
        if (
          typeof specifier === "string" &&
          specifier.startsWith("workspace:") &&
          !selectedNames.has(name)
        ) {
          throw new Error(
            `${manifest.name} depends on workspace package ${name}, but ${packageRoot} is missing it from the local CLI install set.`,
          );
        }
      }
    }
  }
}

export function installLocalCli() {
  assertWorkspaceDependencyClosure(localCliPackageRoots);
  const packRoot = mkdtempSync(join(tmpdir(), "wiki-graph-local-pack-"));

  try {
    execFileSync("pnpm", ["build"], {
      cwd: workspaceRoot,
      stdio: "inherit",
    });
    const tarballPaths = localCliPackageRoots.map((packageRoot) =>
      packPackage(packageRoot, packRoot),
    );

    execFileSync("npm", ["install", "--global", "--force", ...tarballPaths], {
      cwd: workspaceRoot,
      env: createNpmEnv(),
      stdio: "inherit",
    });
  } finally {
    rmSync(packRoot, { force: true, recursive: true });
  }
}

const executableUrl =
  process.argv[1] === undefined
    ? undefined
    : pathToFileURL(resolve(process.argv[1])).href;
if (import.meta.url === executableUrl) {
  installLocalCli();
}
