import { randomUUID } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addWikiGraphLibraryArchive,
  createWikiGraphLibrary,
  DirectoryDocument,
  parseWikiGraphLibraryUri,
  readWikiGraphLibraryIndexState,
  rebuildWikiGraphLibraryIndex,
  TOC_FILE_VERSION,
  writeWikgArchive,
} from "wiki-graph-core";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../../../core/src/runtime/common/wiki-graph/dir.js";
import { runArchiveChapterCommand } from "../chapter.js";
import { resolveArchiveCommandRuntimeArguments } from "./uri.js";

let previousStateDir: string | undefined;
let tempDir: string;

beforeEach(async () => {
  previousStateDir = getWikiGraphStateDirectoryPathForTesting();
  tempDir = await mkdtemp(join(tmpdir(), "wikigraph-cli-uri-test-"));
  setWikiGraphStateDirectoryPathForTesting(join(tempDir, "state"));
});

afterEach(async () => {
  setWikiGraphStateDirectoryPathForTesting(previousStateDir);
  await rm(tempDir, { force: true, recursive: true });
});

describe("archive-command URI runtime resolution", () => {
  it("resolves library archive object URIs before running archive commands", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const source = join(tempDir, "book.wikg");
    await writeFile(source, "content");
    const archive = await addWikiGraphLibraryArchive({
      inputPath: source,
      target: target!,
      to: "books/book.wikg",
    });

    await expect(
      resolveArchiveCommandRuntimeArguments({
        action: "get",
        archivePath: `${archive.uri}/entity/Q23`,
        format: "json",
        objectId: `${archive.uri}/entity/Q23`,
      }),
    ).resolves.toStrictEqual({
      action: "get",
      archivePath: `wikg://${archive.path}/entity/Q23`,
      format: "json",
      objectId: `wikg://${archive.path}/entity/Q23`,
    });
  });

  it("marks the default library index dirty after successful archive writes through a library locator", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const archive = await addTestArchiveToLibrary(target!);

    await rebuildWikiGraphLibraryIndex(target!);
    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "current",
    });

    await runArchiveChapterCommand({ action: "add", path: archive.uri });

    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "dirty",
    });
  });

  it("marks the explicit library index dirty after successful archive writes through a library locator", async () => {
    const library = await createWikiGraphLibrary({
      folderPath: join(tempDir, "team-library"),
    });
    const target = parseWikiGraphLibraryUri(library.uri);
    expect(target).toBeDefined();
    const archive = await addTestArchiveToLibrary(target!);

    await rebuildWikiGraphLibraryIndex(target!);
    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "current",
    });

    await runArchiveChapterCommand({ action: "add", path: archive.uri });

    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "dirty",
    });
  });

  it("does not dirty a library index for filesystem archive URI writes", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const archive = await addTestArchiveToLibrary(target!);

    await rebuildWikiGraphLibraryIndex(target!);
    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "current",
    });

    await runArchiveChapterCommand({
      action: "add",
      path: `wikg://${archive.path}`,
    });

    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "current",
    });
  });

  it("does not dirty a library index when an archive write fails", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const archive = await addTestArchiveToLibrary(target!);

    await rebuildWikiGraphLibraryIndex(target!);
    await expect(
      runArchiveChapterCommand({
        action: "set-title",
        path: archive.uri,
        chapterPath: "missing",
        title: "Nope",
      }),
    ).rejects.toThrow();

    await expect(
      readWikiGraphLibraryIndexState(target!),
    ).resolves.toMatchObject({
      status: "current",
    });
  });
});

async function addTestArchiveToLibrary(
  target: NonNullable<ReturnType<typeof parseWikiGraphLibraryUri>>,
): ReturnType<typeof addWikiGraphLibraryArchive> {
  const source = join(tempDir, `${randomUUID()}.wikg`);
  await createEmptyArchive(source);

  return await addWikiGraphLibraryArchive({
    inputPath: source,
    target,
    to: `${randomUUID()}.wikg`,
  });
}

async function createEmptyArchive(path: string): Promise<void> {
  const sourceDir = await mkdtemp(join(tempDir, "wikg-source-"));
  const document = await DirectoryDocument.open(sourceDir);

  try {
    try {
      await document.openSession(async (openedDocument) => {
        await openedDocument.writeToc({ items: [], version: TOC_FILE_VERSION });
      });
    } finally {
      await document.release();
    }
    await writeWikgArchive(sourceDir, path);
  } finally {
    await rm(sourceDir, { force: true, recursive: true });
  }
}
