import { execFile } from "child_process";
import { promisify } from "util";

import { describe, expect, it } from "vitest";

import { WikiGraph } from "../../../../packages/core/src/api/app.js";
import {
  getWikiGraphStorage,
  type Directory,
  type File,
  type WikiGraphStorage,
} from "../../../../packages/core/src/runtime/platform/index.js";

const execFileAsync = promisify(execFile);

describe("SDK host lifecycle", () => {
  it("imports Core without installing a Node adapter", async () => {
    const script = `
const core = await import("./packages/core/src/index.ts");
console.log(JSON.stringify({ wikiGraph: typeof core.WikiGraph, hasFileFactory: "NodeFile" in core }));
`;
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd() },
    );
    expect(JSON.parse(stdout.trim())).toEqual({
      hasFileFactory: false,
      wikiGraph: "function",
    });
  });

  it("binds async contexts when the host is installed after Core imports", async () => {
    const script = `
await import("./packages/core/src/index.ts");
const node = await import("./packages/cli/src/runtime/node-platform.ts");
node.installNodeWikiGraphPlatform();
const state = await import("./test/helpers/wiki-graph-storage.ts");
const fs = await import("node:fs/promises");
const os = await import("node:os");
const path = await import("node:path");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikigraph-context-"));
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const observed = await Promise.all([
  state.withWikiGraphStateDirectoryPathForTesting(path.join(root, "context-a"), async () => {
    await pause(20);
    return state.resolveWikiGraphHomeDirectoryPath();
  }),
  state.withWikiGraphStateDirectoryPathForTesting(path.join(root, "context-b"), async () => {
    await pause(5);
    return state.resolveWikiGraphHomeDirectoryPath();
  }),
]);
await fs.rm(root, { force: true, recursive: true });
console.log(JSON.stringify(observed.map((value) => path.basename(value))));
`;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd() },
    );

    expect(JSON.parse(stdout.trim())).toEqual(["context-a", "context-b"]);
  });

  it("keeps per-instance storage out of process-default state", () => {
    const defaultStorage = getWikiGraphStorage();
    const first = createStorage("first");
    const second = createStorage("second");

    new WikiGraph({ storage: first });
    new WikiGraph({ storage: second });

    expect(getWikiGraphStorage()).toBe(defaultStorage);
  });
});

function createStorage(name: string): WikiGraphStorage {
  return {
    documentStore: new MemoryDirectory(`${name}-documents`),
    library: new MemoryDirectory(`${name}-library`),
  };
}

class MemoryDirectory implements Directory {
  public readonly identity: string;
  public readonly kind = "directory" as const;
  public readonly name: string;

  public constructor(name: string) {
    this.identity = `memory:${name}`;
    this.name = name;
  }

  public createDirectory(name: string): Promise<Directory> {
    return Promise.resolve(new MemoryDirectory(name));
  }

  public createFile(): Promise<File> {
    return Promise.reject(new Error("Not used by this lifecycle test"));
  }

  public getDirectory(): Promise<Directory | undefined> {
    return Promise.resolve(undefined);
  }

  public getFile(): Promise<File | undefined> {
    return Promise.resolve(undefined);
  }

  public list(): Promise<ReadonlyArray<File | Directory>> {
    return Promise.resolve([]);
  }

  public remove(): Promise<void> {
    return Promise.resolve();
  }
}
