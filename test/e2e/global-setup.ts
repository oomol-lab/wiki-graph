import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";

const projectRoot = resolve(import.meta.dirname, "../..");

export default function setup({
  provide,
}: {
  readonly provide: (key: "cliE2E", value: CLIContext) => void;
}): () => Promise<void> {
  const suiteRoot = mkdtempSync(join(tmpdir(), "wiki-graph-cli-e2e-"));
  const packsRoot = join(suiteRoot, "packs");
  const installRoot = join(suiteRoot, "install");
  const packageRoots = {
    "wiki-graph-core": join(projectRoot, "packages", "core"),
    "wiki-graph-job": join(projectRoot, "packages", "job"),
    "wiki-graph-sdk": join(projectRoot, "packages", "sdk"),
    "wiki-graph-wikimedia": join(projectRoot, "packages", "wikimedia"),
    "wiki-graph": join(projectRoot, "packages", "cli"),
  } as const;

  mkdirSync(packsRoot, { recursive: true });
  const tarballs = Object.fromEntries(
    Object.entries(packageRoots).map(([name, packageRoot]) => [
      name,
      packPackage(packageRoot, packsRoot),
    ]),
  );

  mkdirSync(installRoot, { recursive: true });
  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify({ name: "wiki-graph-cli-e2e-install", private: true }),
  );
  writeFileSync(
    join(installRoot, "pnpm-workspace.yaml"),
    [
      "allowBuilds:",
      "  sqlite3: true",
      "overrides:",
      ...Object.entries(tarballs)
        .filter(([name]) => name !== "wiki-graph")
        .map(
          ([name, tarball]) =>
            `  ${JSON.stringify(name)}: ${JSON.stringify(`file:${tarball}`)}`,
        ),
      "",
    ].join("\n"),
  );
  execFileSync(
    "pnpm",
    ["add", tarballs["wiki-graph"]!, tarballs["wiki-graph-sdk"]!],
    {
      cwd: installRoot,
      stdio: "inherit",
    },
  );

  const cliPath = join(installRoot, "node_modules", ".bin", "wg");
  provide("cliE2E", { cliPath, installRoot, suiteRoot });

  return async () => {
    // Detached queue workers remain alive for up to ten seconds after their
    // final job. Keep their isolated homes available until they release them.
    await delay(11_000);
    rmSync(suiteRoot, { force: true, recursive: true });
  };
}

interface CLIContext {
  readonly cliPath: string;
  readonly installRoot: string;
  readonly suiteRoot: string;
}

function packPackage(packageRoot: string, packsRoot: string): string {
  const output = execFileSync(
    "pnpm",
    ["pack", "--json", "--pack-destination", packsRoot],
    {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const parsed: unknown = JSON.parse(output);
  const filename = Array.isArray(parsed)
    ? readFilename(parsed[0])
    : readFilename(parsed);
  return isAbsolute(filename) ? filename : join(packsRoot, filename);
}

function readFilename(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("filename" in value) ||
    typeof value.filename !== "string" ||
    value.filename === ""
  ) {
    throw new Error("pnpm pack did not return a tarball filename.");
  }
  return value.filename;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

declare module "vitest" {
  export interface ProvidedContext {
    cliE2E: {
      readonly cliPath: string;
      readonly installRoot: string;
      readonly suiteRoot: string;
    };
  }
}
