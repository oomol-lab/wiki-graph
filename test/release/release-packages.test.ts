import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
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
});
