import { mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import { NodeDirectory } from "../../../cli/src/runtime/node-platform.js";
import { copyFileContent } from "../runtime/platform/index.js";
import {
  beginLibraryMembershipTransaction,
  copyDirectoryContent,
} from "./membership-transaction.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("library membership transactions", () => {
  it("removes a partially added archive before publication", async () => {
    const setup = await createSetup();
    const transaction = await beginLibraryMembershipTransaction(
      setup.library,
      setup.staging,
      { kind: "add", targetPath: "book.wikg" },
    );
    const partial = await setup.library.createDirectory("book.wikg");
    await partial.createFile("manifest.json");

    await transaction.recover();

    await expect(
      stat(join(setup.root, "library", "book.wikg")),
    ).rejects.toThrow();
    await expect(setup.staging.list()).resolves.toEqual([]);
  });

  it("restores a removed directory from its durable backup", async () => {
    const setup = await createSetup();
    const source = await setup.library.createDirectory("book.wikg");
    await writeFile(
      join(setup.root, "library", "book.wikg", "manifest.json"),
      "complete",
    );
    const transaction = await beginLibraryMembershipTransaction(
      setup.library,
      setup.staging,
      {
        kind: "remove",
        sourceKind: "directory",
        sourcePath: "book.wikg",
      },
    );
    await copyDirectoryContent(
      source,
      await transaction.createBackupDirectory(),
    );
    await setup.library.remove("book.wikg", { recursive: true });
    const partial = await setup.library.createDirectory("book.wikg");
    await partial.createFile("partial");

    await transaction.recover();

    await expect(
      readFile(
        join(setup.root, "library", "book.wikg", "manifest.json"),
        "utf8",
      ),
    ).resolves.toBe("complete");
    await expect(
      stat(join(setup.root, "library", "book.wikg", "partial")),
    ).rejects.toThrow();
  });

  it("finishes a published move by removing the old directory", async () => {
    const setup = await createSetup();
    const source = await setup.library.createDirectory("old.wikg");
    await writeFile(
      join(setup.root, "library", "old.wikg", "manifest.json"),
      "complete",
    );
    const target = await setup.library.createDirectory("new.wikg");
    await copyDirectoryContent(source, target);
    const transaction = await beginLibraryMembershipTransaction(
      setup.library,
      setup.staging,
      {
        kind: "move",
        sourcePath: "old.wikg",
        targetPath: "new.wikg",
      },
    );
    await transaction.markPublished();

    await transaction.recover();

    await expect(
      stat(join(setup.root, "library", "old.wikg")),
    ).rejects.toThrow();
    await expect(
      readFile(
        join(setup.root, "library", "new.wikg", "manifest.json"),
        "utf8",
      ),
    ).resolves.toBe("complete");
  });

  it("restores the archive file when migration stops before publication", async () => {
    const setup = await createSetup();
    await writeFile(join(setup.root, "library", "book.wikg"), "archive");
    const source = await setup.library.getFile("book.wikg");
    const transaction = await beginLibraryMembershipTransaction(
      setup.library,
      setup.staging,
      { kind: "migrate", targetPath: "book.wikg" },
    );
    await copyFileContent(source!, await transaction.createBackupFile());
    await setup.library.remove("book.wikg");
    const partial = await setup.library.createDirectory("book.wikg");
    await partial.createFile("partial");

    await transaction.recover();

    await expect(
      readFile(join(setup.root, "library", "book.wikg"), "utf8"),
    ).resolves.toBe("archive");
  });
});

async function createSetup(): Promise<{
  readonly library: NodeDirectory;
  readonly root: string;
  readonly staging: NodeDirectory;
}> {
  const root = await mkdtemp(join(tmpdir(), "wikigraph-membership-txn-"));
  temporaryDirectories.push(root);
  const workspace = new NodeDirectory(root);
  const library = (await workspace.createDirectory("library")) as NodeDirectory;
  const staging = (await workspace.createDirectory("staging")) as NodeDirectory;
  return { library, root, staging };
}
