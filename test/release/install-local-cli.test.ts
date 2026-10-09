import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWorkspaceDependencyClosure,
  localCliPackageRoots,
} from "../../scripts/install-local-cli.js";

const temporaryDirectories: string[] = [];

function createPackage(
  name: string,
  dependencies: Readonly<Record<string, string>> = {},
): string {
  const directory = mkdtempSync(join(tmpdir(), "wiki-graph-local-cli-test-"));
  temporaryDirectories.push(directory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ dependencies, name, version: "1.0.0" }),
  );
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("local CLI package installation", () => {
  it("covers the current CLI workspace dependency graph", () => {
    expect(() =>
      assertWorkspaceDependencyClosure(localCliPackageRoots),
    ).not.toThrow();
  });

  it("rejects a missing workspace dependency", () => {
    const cli = createPackage("cli", { sdk: "workspace:*" });

    expect(() => assertWorkspaceDependencyClosure([cli])).toThrow(
      "cli depends on workspace package sdk",
    );
  });

  it("accepts a closed workspace dependency set", () => {
    const sdk = createPackage("sdk");
    const cli = createPackage("cli", { sdk: "workspace:*" });

    expect(() => assertWorkspaceDependencyClosure([sdk, cli])).not.toThrow();
  });
});
