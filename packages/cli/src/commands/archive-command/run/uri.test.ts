import { randomUUID } from "crypto";
import { mkdtemp, rm } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addWikiGraphLibraryArchive,
  createWikiGraphLibrary,
  parseWikiGraphLibraryUri,
  readWikiGraphLibraryIndexState,
  rebuildArchiveSearchIndex,
  rebuildWikiGraphLibraryIndex,
  replaceChapterFtsIndexArtifact,
  WikiGraphArchiveFile,
} from "../../../../../core/src/index.js";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../../../../test/helpers/wiki-graph-storage.js";
import { readWikgArchiveEntry } from "../../../../../core/src/storage/wikg/archive/index.js";
import { runArchiveChapterCommand } from "../chapter.js";
import {
  getArchivePath,
  getObjectUri,
  isArchiveRootGet,
  resolveArchiveCommandRuntimeArguments,
} from "./uri.js";
import { createEmptyArchive } from "../../test-helpers.js";
import {
  getNodeResourcePath,
  NodeDirectory,
  NodeFile,
} from "../../../runtime/node-platform.js";

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
  it("expands home archive locators consistently for root and child URIs", () => {
    const archivePath = join(
      process.env.HOME?.trim() || homedir(),
      "Books",
      "The little prince.wikg",
    );
    const cases = [
      ["wikg://~/Books/The little prince.wikg", "wikg://"],
      ["wikg://~/Books/The little prince.wikg/chapter", "wikg://chapter"],
      [
        "wikg://~/Books/The little prince.wikg/chapter/part/source",
        "wikg://chapter/part/source",
      ],
      ["wikg://~/Books/The little prince.wikg/index", "wikg://index"],
      ["wikg://~/Books/The little prince.wikg/entity/Q42", "wikg://entity/Q42"],
    ] as const;

    for (const [uri, objectUri] of cases) {
      expect(getArchivePath(uri)).toBe(archivePath);
      expect(getObjectUri(uri)).toBe(objectUri);
    }

    expect(
      isArchiveRootGet({
        action: "get",
        archivePath: cases[0][0],
        objectId: cases[0][0],
      }),
    ).toBe(true);
    expect(
      isArchiveRootGet({
        action: "get",
        archivePath: cases[1][0],
        objectId: cases[1][0],
      }),
    ).toBe(false);
  });

  it("preserves library archive object URIs before running archive commands", async () => {
    const target = await createTestLibraryTarget();
    const source = join(tempDir, "book.wikg");
    await createEmptyArchive({ path: source, tempDir });
    const archive = await addWikiGraphLibraryArchive({
      inputFile: new NodeFile(source),
      target,
      to: "books/book.wikg",
    });

    expect(
      resolveArchiveCommandRuntimeArguments({
        action: "get",
        archivePath: `${archive.uri}/entity/Q23`,
        format: "json",
        objectId: `${archive.uri}/entity/Q23`,
      }),
    ).toStrictEqual({
      action: "get",
      archivePath: `${archive.uri}/entity/Q23`,
      format: "json",
      objectId: `${archive.uri}/entity/Q23`,
    });
  });

  it("keeps library archive inspect arguments displayable", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const archive = await addTestArchiveToLibrary(target!);

    expect(
      resolveArchiveCommandRuntimeArguments({
        action: "inspect",
        archivePath: archive.uri,
      }),
    ).toStrictEqual({
      action: "inspect",
      archivePath: archive.uri,
    });
  });

  it("keeps library index current after archive writes through a library locator", async () => {
    const target = await createTestLibraryTarget();
    const archive = await addTestArchiveToLibrary(target);

    await rebuildWikiGraphLibraryIndex(target);
    await expect(readWikiGraphLibraryIndexState(target)).resolves.toMatchObject(
      {
        status: "current",
      },
    );

    await runArchiveChapterCommand({ action: "add", path: archive.uri });

    await expect(readWikiGraphLibraryIndexState(target)).resolves.toMatchObject(
      {
        status: "current",
      },
    );
  });

  it("keeps explicit library index current after archive writes through a library locator", async () => {
    const library = await createWikiGraphLibrary({
      folder: new NodeDirectory(join(tempDir, "team-library")),
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
      status: "current",
    });
  });

  it("rejects filesystem access to a managed archive", async () => {
    const target = await createTestLibraryTarget();
    const archive = await addTestArchiveToLibrary(target);

    await rebuildWikiGraphLibraryIndex(target);
    await expect(readWikiGraphLibraryIndexState(target)).resolves.toMatchObject(
      {
        status: "current",
      },
    );

    await expect(
      runArchiveChapterCommand({
        action: "add",
        path: `wikg://${getNodeResourcePath(archive.file!)}`,
      }),
    ).rejects.toThrow(/library UUID URI/u);
  });

  it("does not dirty a library index when an archive write fails", async () => {
    const target = await createTestLibraryTarget();
    const archive = await addTestArchiveToLibrary(target);

    await rebuildWikiGraphLibraryIndex(target);
    await expect(
      runArchiveChapterCommand({
        action: "set-title",
        path: archive.uri,
        chapterPath: "missing",
        title: "Nope",
      }),
    ).rejects.toThrow();

    await expect(readWikiGraphLibraryIndexState(target)).resolves.toMatchObject(
      {
        status: "current",
      },
    );
  });

  it("keeps index cache external during library archive URI writes", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const archive = await addTestArchiveToLibrary(target!);

    await new WikiGraphArchiveFile(archive.file!).write(
      async (document) => {
        await replaceChapterFtsIndexArtifact(document, 1);
        await rebuildArchiveSearchIndex(document);
      },
      { searchIndexWritebackPolicy: "archive" },
    );
    await expect(
      readWikgArchiveEntry(getNodeResourcePath(archive.file!), "index.db"),
    ).resolves.toBeUndefined();

    await runArchiveChapterCommand({ action: "add", path: archive.uri });

    await expect(
      readWikgArchiveEntry(getNodeResourcePath(archive.file!), "index.db"),
    ).resolves.toBe(undefined);
    const state = await readWikiGraphLibraryIndexState(target!);

    expect(["current", "dirty"]).toContain(state.status);
  });
});

async function addTestArchiveToLibrary(
  target: NonNullable<ReturnType<typeof parseWikiGraphLibraryUri>>,
): ReturnType<typeof addWikiGraphLibraryArchive> {
  const source = join(tempDir, `${randomUUID()}.wikg`);
  await createEmptyArchive({ path: source, tempDir });

  return await addWikiGraphLibraryArchive({
    inputFile: new NodeFile(source),
    target,
    to: `${randomUUID()}.wikg`,
  });
}

async function createTestLibraryTarget(): Promise<
  NonNullable<ReturnType<typeof parseWikiGraphLibraryUri>>
> {
  const library = await createWikiGraphLibrary({
    folder: new NodeDirectory(join(tempDir, `library-${randomUUID()}`)),
  });
  const target = parseWikiGraphLibraryUri(library.uri);

  if (target === undefined) {
    throw new Error(`Invalid test library URI: ${library.uri}`);
  }

  return target;
}
