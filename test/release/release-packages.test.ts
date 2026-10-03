import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  orderPackageDescriptors,
  packageContentDifference,
  packageContentHashes,
} from "../../scripts/release-packages.js";

const temporaryDirectories: string[] = [];

function createPackage(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "wiki-graph-release-test-"));
  temporaryDirectories.push(directory);
  for (const [path, contents] of Object.entries(files)) {
    const absolutePath = join(directory, path);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, contents);
  }
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("release package comparison", () => {
  it("compares package contents independently of file timestamps", () => {
    const first = createPackage({
      "dist/index.js": "export const answer = 42;\n",
      "package.json": '{"name":"example","version":"1.0.0"}\n',
    });
    const second = createPackage({
      "dist/index.js": "export const answer = 42;\n",
      "package.json": '{"name":"example","version":"1.0.0"}\n',
    });

    expect(packageContentDifference(first, second)).toEqual([]);
    expect(packageContentHashes(first).size).toBe(2);
  });

  it("reports changed, added, and removed files", () => {
    const local = createPackage({
      "dist/added.js": "added\n",
      "dist/index.js": "new\n",
    });
    const published = createPackage({
      "dist/index.js": "old\n",
      "dist/removed.js": "removed\n",
    });

    expect(packageContentDifference(local, published)).toEqual([
      "dist/added.js",
      "dist/index.js",
      "dist/removed.js",
    ]);
  });

  it("ignores versions resolved from workspace dependencies", () => {
    const local = createPackage({
      "dist/index.js": "export const answer = 42;\n",
      "package.json":
        '{"name":"cli","version":"1.0.0","dependencies":{"sdk":"1.1.0"}}\n',
    });
    const published = createPackage({
      "dist/index.js": "export const answer = 42;\n",
      "package.json":
        '{"name":"cli","version":"1.0.0","dependencies":{"sdk":"1.0.0"}}\n',
    });

    expect(packageContentDifference(local, published, ["sdk"])).toEqual([]);
    expect(packageContentDifference(local, published)).toEqual([
      "package.json",
    ]);
  });

  it("does not ignore adding or removing a workspace dependency", () => {
    const local = createPackage({
      "package.json": '{"name":"cli","version":"1.0.0","dependencies":{}}\n',
    });
    const published = createPackage({
      "package.json":
        '{"name":"cli","version":"1.0.0","dependencies":{"sdk":"1.0.0"}}\n',
    });

    expect(packageContentDifference(local, published, ["sdk"])).toEqual([
      "package.json",
    ]);
  });
});

describe("release package ordering", () => {
  function descriptor(
    name: string,
    dependencyNames: readonly string[] = [],
    workspaceDependencyNames: readonly string[] = dependencyNames,
  ) {
    return {
      name,
      version: "1.0.0",
      dependencyNames,
      workspaceDependencyNames,
    };
  }

  it("orders workspace packages before their dependants", () => {
    const packages = [
      descriptor("cli", ["sdk", "provider"]),
      descriptor("core", ["job", "provider"]),
      descriptor("sdk", ["core"]),
      descriptor("provider"),
      descriptor("job"),
    ];

    expect(orderPackageDescriptors(packages).map(({ name }) => name)).toEqual([
      "provider",
      "job",
      "core",
      "sdk",
      "cli",
    ]);
  });

  it("rejects workspace dependencies omitted from the release plan", () => {
    expect(() =>
      orderPackageDescriptors([descriptor("core", ["job"])]),
    ).toThrow(
      "core depends on workspace package job, but it is missing from the release plan.",
    );
  });

  it("rejects dependency cycles", () => {
    expect(() =>
      orderPackageDescriptors([
        descriptor("core", ["sdk"]),
        descriptor("sdk", ["core"]),
      ]),
    ).toThrow("Release package dependency cycle: core, sdk.");
  });
});
