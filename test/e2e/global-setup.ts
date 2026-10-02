import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";

const projectRoot = resolve(import.meta.dirname, "../..");

export default function setup({
  provide,
}: {
  readonly provide: (key: "cliE2E", value: CLIContext) => void;
}): () => Promise<void> {
  const suiteRoot = mkdtempSync(join(tmpdir(), "wiki-graph-cli-e2e-"));
  try {
    const packsRoot = join(suiteRoot, "packs");
    const installRoot = join(suiteRoot, "install");
    const bootstrapRoot = join(suiteRoot, "bootstrap");
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
    const overrides = Object.fromEntries(
      Object.entries(tarballs)
        .filter(([name]) => name !== "wiki-graph")
        .map(([name, tarball]) => [name, `file:${tarball}`]),
    );

    writeInstallWorkspace(installRoot, "wiki-graph-cli-e2e-install", overrides);
    installTarballs(installRoot, [tarballs["wiki-graph"]!]);

    writeInstallWorkspace(
      bootstrapRoot,
      "wiki-graph-cli-e2e-bootstrap",
      overrides,
    );
    installTarballs(bootstrapRoot, [tarballs["wiki-graph-sdk"]!]);

    const cliPath = join(installRoot, "node_modules", ".bin", "wg");
    provide("cliE2E", { bootstrapRoot, cliPath, installRoot, suiteRoot });

    return async () => {
      try {
        await waitForWorkersToExit(suiteRoot, 30_000);
      } finally {
        rmSync(suiteRoot, { force: true, recursive: true });
      }
    };
  } catch (error) {
    rmSync(suiteRoot, { force: true, recursive: true });
    throw error;
  }
}

interface CLIContext {
  readonly bootstrapRoot: string;
  readonly cliPath: string;
  readonly installRoot: string;
  readonly suiteRoot: string;
}

function writeInstallWorkspace(
  root: string,
  name: string,
  overrides: Readonly<Record<string, string>>,
): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, private: true }),
  );
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    [
      "allowBuilds:",
      "  sqlite3: true",
      "overrides:",
      ...Object.entries(overrides).map(
        ([packageName, tarball]) =>
          `  ${JSON.stringify(packageName)}: ${JSON.stringify(tarball)}`,
      ),
      "",
    ].join("\n"),
  );
}

function installTarballs(root: string, tarballs: readonly string[]): void {
  execFileSync(
    "pnpm",
    ["add", "--prefer-offline", "--save-exact", ...tarballs],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
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

async function waitForWorkersToExit(
  suiteRoot: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await hasActiveWorkerLease(suiteRoot))) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Detached queue workers did not exit within ${timeoutMs}ms.`);
}

async function hasActiveWorkerLease(suiteRoot: string): Promise<boolean> {
  const casesRoot = join(suiteRoot, "cases");
  if (!existsSync(casesRoot)) return false;
  const { DatabaseSync } = await import("node:sqlite");

  for (const caseName of readdirSync(casesRoot)) {
    const databasePath = join(
      casesRoot,
      caseName,
      "home",
      ".wikigraph",
      "core.sqlite",
    );
    if (!existsSync(databasePath)) continue;

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'build_worker_lease'",
        )
        .get();
      if (table === undefined) continue;
      const row = database
        .prepare("SELECT owner_id FROM build_worker_lease WHERE id = 1")
        .get() as { readonly owner_id?: unknown } | undefined;
      if (typeof row?.owner_id === "string" && row.owner_id !== "") {
        return true;
      }
    } finally {
      database.close();
    }
  }
  return false;
}

declare module "vitest" {
  export interface ProvidedContext {
    cliE2E: {
      readonly bootstrapRoot: string;
      readonly cliPath: string;
      readonly installRoot: string;
      readonly suiteRoot: string;
    };
  }
}
