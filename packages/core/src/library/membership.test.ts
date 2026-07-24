import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";

import {
  addWikiGraphLibraryArchive,
  createWikiGraphLibrary,
  disableWikiGraphLibraryIndex,
  ensureDefaultWikiGraphLibrary,
  finalizeWikiGraphLibraryArchiveWrite,
  getWikiGraphLibraryMetadata,
  isWikiGraphLibraryUri,
  moveWikiGraphLibraryArchive,
  parseLocatedWikiGraphUri,
  parseWikiGraphLibraryUri,
  putWikiGraphLibraryMetadata,
  readArchiveIndexSettings,
  queryWikiGraphLibrarySearchIndex,
  rebuildArchiveSearchIndex,
  rebindWikiGraphLibrary,
  setFtsIndexEmbedded,
  rebuildWikiGraphLibraryIndex,
  removeWikiGraphLibrary,
  removeWikiGraphLibraryArchive,
  resolveWikiGraphLibraryArchivePath,
  resolveWikiGraphLibrary,
  scanWikiGraphLibrary,
  WikiGraphArchiveFile,
} from "../index.js";
import { Database } from "../document/database.js";
import { DirectoryDocument } from "../document/index.js";
import { withWikiGraphStateDirectoryPathForTesting } from "../runtime/common/wiki-graph/dir.js";
import { resolveWikiGraphCoreDatabasePath } from "../runtime/common/wiki-graph/dir.js";
import {
  readWikgArchiveEntry,
  readWikgArchiveMutationToken,
  writeWikgArchive,
} from "../storage/wikg/index.js";
import { acquireWikiGraphLibraryLock } from "./lock.js";
import { listWikiGraphLibrarySearchIndex } from "./search-index.js";

describe("library archive membership", () => {
  it("scans nested .wikg files and reports missing registered files", async () => {
    await withLibraryTestState(async () => {
      const library = await ensureDefaultWikiGraphLibrary();
      await mkdir(join(library.folderPath, "nested"), { recursive: true });
      await writeFile(join(library.folderPath, "a.wikg"), "a");
      await writeFile(join(library.folderPath, "nested", "b.wikg"), "b");

      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const first = await scanWikiGraphLibrary(target!);
      expect(
        first.archives.map((archive) => archive.relativePath),
      ).toStrictEqual(["a.wikg", "nested/b.wikg"]);

      await rm(join(library.folderPath, "a.wikg"));
      const second = await scanWikiGraphLibrary(target!);
      expect(
        second.archives.map((archive) => ({
          relativePath: archive.relativePath,
          status: archive.status,
        })),
      ).toContainEqual({ relativePath: "a.wikg", status: "missing" });
    });
  });

  it("adopts a moved archive only when its mutation token uniquely matches a missing member", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await createTestWikgArchive(
        tempDir,
        join(library.folderPath, "old.wikg"),
      );

      const first = await scanWikiGraphLibrary(target!);
      const oldArchive = first.archives.find(
        (archive) => archive.relativePath === "old.wikg",
      );
      expect(oldArchive?.lastSeenMutationToken).toBeDefined();

      await rename(
        join(library.folderPath, "old.wikg"),
        join(library.folderPath, "renamed.wikg"),
      );
      const second = await scanWikiGraphLibrary(target!);
      const renamedArchive = second.archives.find(
        (archive) => archive.relativePath === "renamed.wikg",
      );
      expect(renamedArchive?.publicId).toBe(oldArchive?.publicId);
      expect(renamedArchive?.status).toBe("present");
      expect(
        second.archives.some((archive) => archive.relativePath === "old.wikg"),
      ).toBe(false);
    });
  });

  it("reports copied-token conflicts instead of silently reusing an archive id", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await createTestWikgArchive(
        tempDir,
        join(library.folderPath, "original.wikg"),
      );
      const first = await scanWikiGraphLibrary(target!);

      await copyFile(
        join(library.folderPath, "original.wikg"),
        join(library.folderPath, "copy.wikg"),
      );
      const second = await scanWikiGraphLibrary(target!);
      const original = second.archives.find(
        (archive) => archive.relativePath === "original.wikg",
      );
      const copy = second.archives.find(
        (archive) => archive.relativePath === "copy.wikg",
      );

      expect(original?.publicId).toBe(first.archives[0]?.publicId);
      expect(copy?.status).toBe("conflict");
      expect(copy?.publicId).not.toBe(original?.publicId);
    });
  });

  it("does not adopt by basename, size, or mtime without a mutation-token match", async () => {
    await withLibraryTestState(async () => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await writeFile(join(library.folderPath, "old.wikg"), "same");
      const first = await scanWikiGraphLibrary(target!);

      await rm(join(library.folderPath, "old.wikg"));
      await writeFile(join(library.folderPath, "new.wikg"), "same");
      const second = await scanWikiGraphLibrary(target!);
      const fresh = second.archives.find(
        (archive) => archive.relativePath === "new.wikg",
      );

      expect(fresh?.publicId).not.toBe(first.archives[0]?.publicId);
      expect(second.archives).toContainEqual(
        expect.objectContaining({
          relativePath: "old.wikg",
          status: "missing",
        }),
      );
    });
  });

  it("adds, moves, and removes managed archives inside the library folder", async () => {
    await withLibraryTestState(async (tempDir) => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const source = join(tempDir, "source.wikg");
      await writeFile(source, "content");

      const added = await addWikiGraphLibraryArchive({
        inputPath: source,
        target: target!,
        to: "nested/book.wikg",
      });
      expect(added.relativePath).toBe("nested/book.wikg");
      expect(added.status).toBe("present");
      expect(await readFile(added.path, "utf8")).toBe("content");

      await expect(
        addWikiGraphLibraryArchive({
          inputPath: "wikg://elsewhere/book.wikg",
          target: target!,
        }),
      ).rejects.toThrow("not a Wiki Graph URI");
      await expect(
        addWikiGraphLibraryArchive({
          inputPath: source,
          target: target!,
          to: "../x.wikg",
        }),
      ).rejects.toThrow("relative path inside the library folder");

      const archiveTarget = parseWikiGraphLibraryUri(added.uri);
      expect(archiveTarget?.kind).toBe("archive");
      const moved = await moveWikiGraphLibraryArchive({
        target: archiveTarget!,
        to: "renamed.wikg",
      });
      expect(moved.publicId).toBe(added.publicId);
      expect(moved.relativePath).toBe("renamed.wikg");

      const removed = await removeWikiGraphLibraryArchive({
        target: archiveTarget!,
      });
      expect(removed.publicId).toBe(added.publicId);
      await expect(readFile(moved.path, "utf8")).rejects.toThrow();
    });
  });

  it("removes embedded FTS entries on library add without changing the archive policy", async () => {
    await withLibraryTestState(async (tempDir) => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const source = join(tempDir, "embedded.wikg");
      await createEmbeddedSearchIndexArchive(tempDir, source);
      const sourceToken = await readWikgArchiveMutationToken(source);

      const added = await addWikiGraphLibraryArchive({
        inputPath: source,
        target: target!,
        to: "embedded.wikg",
      });

      await expect(readWikgArchiveEntry(added.path, "fts.db")).resolves.toBe(
        undefined,
      );
      await expect(readArchiveFtsEmbedded(added.path)).resolves.toBe(true);
      expect(added.lastSeenMutationToken).toBe(
        await readWikgArchiveMutationToken(added.path),
      );
      expect(added.lastSeenMutationToken).not.toBe(sourceToken);
    });
  });

  it("removes embedded FTS entries during scan and records refreshed archive state", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const archivePath = join(library.folderPath, "scanned.wikg");
      await createEmbeddedSearchIndexArchive(tempDir, archivePath);
      const before = await inspectFileState(archivePath);

      const result = await scanWikiGraphLibrary(target!);
      const scanned = result.archives.find(
        (archive) => archive.relativePath === "scanned.wikg",
      );

      await expect(readWikgArchiveEntry(archivePath, "fts.db")).resolves.toBe(
        undefined,
      );
      await expect(readArchiveFtsEmbedded(archivePath)).resolves.toBe(true);
      const after = await inspectFileState(archivePath);
      expect(scanned).toMatchObject({
        lastSeenMtimeMs: Math.round(after.mtimeMs),
        lastSeenMutationToken: after.mutationToken,
        lastSeenSize: after.size,
      });
      expect(after.mutationToken).not.toBe(before.mutationToken);
    });
  });

  it("removes embedded FTS entries during rebind and records refreshed archive state", async () => {
    await withLibraryTestState(async (tempDir) => {
      await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const newFolder = join(tempDir, "rebound-library");
      await mkdir(newFolder);
      const archivePath = join(newFolder, "rebound.wikg");
      await createEmbeddedSearchIndexArchive(tempDir, archivePath);

      const result = await rebindWikiGraphLibrary({
        folderPath: newFolder,
        target: target!,
      });
      const rebound = result.archives.find(
        (archive) => archive.relativePath === "rebound.wikg",
      );

      await expect(readWikgArchiveEntry(archivePath, "fts.db")).resolves.toBe(
        undefined,
      );
      await expect(readArchiveFtsEmbedded(archivePath)).resolves.toBe(true);
      const after = await inspectFileState(archivePath);
      expect(rebound).toMatchObject({
        lastSeenMtimeMs: Math.round(after.mtimeMs),
        lastSeenMutationToken: after.mutationToken,
        lastSeenSize: after.size,
      });
    });
  });

  it("does not rewrite library archives that already have no embedded FTS entry", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const archivePath = join(library.folderPath, "plain.wikg");
      await createTestWikgArchive(tempDir, archivePath);
      const before = await inspectFileState(archivePath);

      await scanWikiGraphLibrary(target!);
      const after = await inspectFileState(archivePath);

      expect(after).toStrictEqual(before);
    });
  });

  it("does not rewrite a library URI write finalization when the archive has no embedded FTS entry", async () => {
    await withLibraryTestState(async (tempDir) => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const source = join(tempDir, "plain-source.wikg");
      await createTestWikgArchive(tempDir, source);
      const added = await addWikiGraphLibraryArchive({
        inputPath: source,
        target: target!,
        to: "plain-finalize.wikg",
      });
      const archiveTarget = parseWikiGraphLibraryUri(added.uri);
      expect(archiveTarget?.kind).toBe("archive");
      const before = await inspectFileState(added.path);

      await expect(
        finalizeWikiGraphLibraryArchiveWrite({ target: archiveTarget! }),
      ).resolves.toBe(false);
      const after = await inspectFileState(added.path);

      expect(after).toStrictEqual(before);
    });
  });

  it("builds and queries the library aggregate index from main archive data when member FTS is absent", async () => {
    await withLibraryTestState(async (tempDir) => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const source = join(tempDir, "searchable.wikg");
      await createSearchableArchiveWithoutSearchIndex(tempDir, source);

      const added = await addWikiGraphLibraryArchive({
        inputPath: source,
        target: target!,
        to: "searchable.wikg",
      });
      await expect(readWikgArchiveEntry(added.path, "fts.db")).resolves.toBe(
        undefined,
      );

      await rebuildWikiGraphLibraryIndex(target!);
      const result = await queryWikiGraphLibrarySearchIndex(
        target!,
        "Libraryless",
      );

      expect(result?.textHits).toContainEqual(
        expect.objectContaining({ libraryArchiveUri: added.uri }),
      );
    });
  });

  it("waits for the library write lock when removing a library registry", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await createWikiGraphLibrary({
        folderPath: join(tempDir, "locked-library"),
      });
      const target = parseWikiGraphLibraryUri(library.uri);
      expect(target).toBeDefined();
      const release = await acquireWikiGraphLibraryLock(library.id, "write");
      const removal = removeWikiGraphLibrary(target!);
      let settled = false;
      void removal.finally(() => {
        settled = true;
      });

      try {
        await delay(20);
        expect(settled).toBe(false);
      } finally {
        await release();
      }

      await expect(removal).resolves.toMatchObject({
        id: library.id,
      });
    });
  });

  it("allows concurrent library read locks", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await createWikiGraphLibrary({
        folderPath: join(tempDir, "readable-library"),
      });
      const firstRelease = await acquireWikiGraphLibraryLock(
        library.id,
        "read",
      );

      try {
        const secondRelease = await acquireWikiGraphLibraryLock(
          library.id,
          "read",
        );
        await secondRelease();
      } finally {
        await firstRelease();
      }
    });
  });

  it("allows concurrent library index read and query operations", async () => {
    await withLibraryTestState(async () => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await rebuildWikiGraphLibraryIndex(target!);

      await expect(
        Promise.all([
          listWikiGraphLibrarySearchIndex(target!),
          queryWikiGraphLibrarySearchIndex(target!, "anything"),
        ]),
      ).resolves.toBeDefined();
    });
  });

  it("waits for foreground library index reads behind a write coordination window", async () => {
    await withLibraryTestState(async () => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const library = await ensureDefaultWikiGraphLibrary();
      await rebuildWikiGraphLibraryIndex(target!);
      const release = await acquireWikiGraphLibraryLock(library.id, "write");
      const query = queryWikiGraphLibrarySearchIndex(target!, "anything");
      let settled = false;
      void query.finally(() => {
        settled = true;
      });

      try {
        await delay(20);
        expect(settled).toBe(false);
      } finally {
        await release();
      }

      await expect(query).resolves.toBeDefined();
    });
  });

  it("coordinates library index disable behind active read paths", async () => {
    await withLibraryTestState(async () => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const library = await ensureDefaultWikiGraphLibrary();
      await rebuildWikiGraphLibraryIndex(target!);
      const release = await acquireWikiGraphLibraryLock(library.id, "read");
      const disable = disableWikiGraphLibraryIndex(target!);
      let settled = false;
      void disable.finally(() => {
        settled = true;
      });

      try {
        await delay(20);
        expect(settled).toBe(false);
      } finally {
        await release();
      }

      await expect(disable).resolves.toMatchObject({ status: "disabled" });
      await expect(
        queryWikiGraphLibrarySearchIndex(target!, "anything"),
      ).rejects.toThrow("Wiki Graph library index is disabled");
    });
  });

  it("cleans stale library state locks before acquiring a foreground lock", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await createWikiGraphLibrary({
        folderPath: join(tempDir, "stale-library"),
      });
      await insertStaleStateLock(library.id);

      const release = await acquireWikiGraphLibraryLock(library.id, "write");

      await release();
    });
  });

  it("rebinds the default library to an existing folder while preserving registry identity and metadata", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await putWikiGraphLibraryMetadata(target!, "owner", "default-team");
      await writeFile(join(library.folderPath, "old-only.wikg"), "old");

      const newFolder = join(tempDir, "icloud-library");
      await mkdir(newFolder);
      await createTestWikgArchive(tempDir, join(newFolder, "synced.wikg"));

      const result = await rebindWikiGraphLibrary({
        folderPath: newFolder,
        target: target!,
      });
      const rebound = await ensureDefaultWikiGraphLibrary();

      expect(rebound).toMatchObject({
        id: library.id,
        isDefault: true,
        publicId: library.publicId,
        uri: library.uri,
      });
      expect(rebound.folderPath).toBe(newFolder);
      await expect(
        readFile(join(library.folderPath, "old-only.wikg"), "utf8"),
      ).resolves.toBe("old");
      await expect(
        readFile(join(newFolder, "synced.wikg")),
      ).resolves.toBeDefined();
      await expect(getDefaultMetadata(target!)).resolves.toStrictEqual({
        owner: "default-team",
      });
      expect(result.archives).toContainEqual(
        expect.objectContaining({
          relativePath: "synced.wikg",
          status: "present",
        }),
      );
    });
  });

  it("rebinds only the addressed non-default library and rejects invalid folder targets", async () => {
    await withLibraryTestState(async (tempDir) => {
      const defaultLibrary = await ensureDefaultWikiGraphLibrary();
      const teamLibrary = await createWikiGraphLibrary({
        folderPath: join(tempDir, "team-old"),
      });
      const otherLibrary = await createWikiGraphLibrary({
        folderPath: join(tempDir, "other-bound"),
      });
      const teamTarget = parseWikiGraphLibraryUri(teamLibrary.uri);
      expect(teamTarget).toBeDefined();
      const newFolder = join(tempDir, "team-new");
      await mkdir(newFolder);

      await expect(
        rebindWikiGraphLibrary({
          folderPath: join(tempDir, "missing"),
          target: teamTarget!,
        }),
      ).rejects.toThrow("does not exist");
      const fileTarget = join(tempDir, "not-directory");
      await writeFile(fileTarget, "file");
      await expect(
        rebindWikiGraphLibrary({ folderPath: fileTarget, target: teamTarget! }),
      ).rejects.toThrow("must be an existing directory");
      await expect(
        rebindWikiGraphLibrary({
          folderPath: otherLibrary.folderPath,
          target: teamTarget!,
        }),
      ).rejects.toThrow("already bound to another library");

      await rebindWikiGraphLibrary({
        folderPath: newFolder,
        target: teamTarget!,
      });

      await expect(resolveWikiGraphLibrary(teamTarget!)).resolves.toMatchObject(
        {
          folderPath: newFolder,
          id: teamLibrary.id,
        },
      );
      await expect(
        resolveWikiGraphLibrary(parseWikiGraphLibraryUri("wikg://lib")!),
      ).resolves.toMatchObject({ folderPath: defaultLibrary.folderPath });
    });
  });

  it("preserves archive public ids when rebind scan sees a moved mutation token", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await createTestWikgArchive(
        tempDir,
        join(library.folderPath, "old.wikg"),
      );
      const first = await scanWikiGraphLibrary(target!);
      const oldArchive = first.archives.find(
        (archive) => archive.relativePath === "old.wikg",
      );
      expect(oldArchive?.lastSeenMutationToken).toBeDefined();

      const newFolder = join(tempDir, "new-library-folder");
      await mkdir(newFolder);
      await rename(
        join(library.folderPath, "old.wikg"),
        join(newFolder, "renamed.wikg"),
      );

      const rebound = await rebindWikiGraphLibrary({
        folderPath: newFolder,
        target: target!,
      });
      const renamed = rebound.archives.find(
        (archive) => archive.relativePath === "renamed.wikg",
      );

      expect(renamed?.publicId).toBe(oldArchive?.publicId);
      expect(renamed?.status).toBe("present");
      expect(
        rebound.archives.some((archive) => archive.relativePath === "old.wikg"),
      ).toBe(false);
    });
  });

  it("keeps ordinary scan path identity trusted when a same-path archive token changes", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await createTestWikgArchive(
        tempDir,
        join(library.folderPath, "book.wikg"),
      );
      const first = await scanWikiGraphLibrary(target!);
      const original = first.archives.find(
        (archive) => archive.relativePath === "book.wikg",
      );
      expect(original?.lastSeenMutationToken).toBeDefined();

      await rm(join(library.folderPath, "book.wikg"));
      await createTestWikgArchive(
        tempDir,
        join(library.folderPath, "book.wikg"),
      );
      const second = await scanWikiGraphLibrary(target!);
      const replaced = second.archives.find(
        (archive) => archive.relativePath === "book.wikg",
      );

      expect(replaced?.publicId).toBe(original?.publicId);
      expect(replaced?.lastSeenMutationToken).not.toBe(
        original?.lastSeenMutationToken,
      );
      expect(second.archives).toHaveLength(1);
    });
  });

  it("does not inherit archive public ids by same relative path during rebind", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await createTestWikgArchive(
        tempDir,
        join(library.folderPath, "book.wikg"),
      );
      const first = await scanWikiGraphLibrary(target!);
      const oldArchive = first.archives.find(
        (archive) => archive.relativePath === "book.wikg",
      );
      expect(oldArchive?.lastSeenMutationToken).toBeDefined();

      const newFolder = join(tempDir, "new-library-folder");
      await mkdir(newFolder);
      await createTestWikgArchive(tempDir, join(newFolder, "book.wikg"));
      const rebound = await rebindWikiGraphLibrary({
        folderPath: newFolder,
        target: target!,
      });
      const archivesAtPath = rebound.archives.filter(
        (archive) => archive.relativePath === "book.wikg",
      );
      const fresh = archivesAtPath.find(
        (archive) => archive.publicId !== oldArchive?.publicId,
      );

      expect(fresh?.status).toBe("present");
      expect(fresh?.lastSeenMutationToken).not.toBe(
        oldArchive?.lastSeenMutationToken,
      );
      expect(rebound.archives).toContainEqual(
        expect.objectContaining({
          publicId: oldArchive?.publicId,
          relativePath: "book.wikg",
          status: "missing",
        }),
      );
    });
  });

  it("preserves archive public ids when rebind renames a same-token archive", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await createTestWikgArchive(
        tempDir,
        join(library.folderPath, "book.wikg"),
      );
      const first = await scanWikiGraphLibrary(target!);
      const original = first.archives.find(
        (archive) => archive.relativePath === "book.wikg",
      );
      expect(original?.lastSeenMutationToken).toBeDefined();

      const newFolder = join(tempDir, "new-library-folder");
      await mkdir(newFolder);
      await copyFile(
        join(library.folderPath, "book.wikg"),
        join(newFolder, "renamed-book.wikg"),
      );
      const rebound = await rebindWikiGraphLibrary({
        folderPath: newFolder,
        target: target!,
      });
      const reboundArchive = rebound.archives.find(
        (archive) => archive.relativePath === "renamed-book.wikg",
      );

      expect(reboundArchive?.publicId).toBe(original?.publicId);
      expect(reboundArchive?.lastSeenMutationToken).toBe(
        original?.lastSeenMutationToken,
      );
      expect(reboundArchive?.relativePath).toBe("renamed-book.wikg");
      expect(reboundArchive?.status).toBe("present");
      expect(rebound.archives).toHaveLength(1);
    });
  });

  it("preserves archive public ids when rebind keeps the same path and mutation token", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await createTestWikgArchive(
        tempDir,
        join(library.folderPath, "book.wikg"),
      );
      const first = await scanWikiGraphLibrary(target!);
      const original = first.archives.find(
        (archive) => archive.relativePath === "book.wikg",
      );
      expect(original?.lastSeenMutationToken).toBeDefined();

      const newFolder = join(tempDir, "new-library-folder");
      await mkdir(newFolder);
      await copyFile(
        join(library.folderPath, "book.wikg"),
        join(newFolder, "book.wikg"),
      );
      const rebound = await rebindWikiGraphLibrary({
        folderPath: newFolder,
        target: target!,
      });
      const reboundArchive = rebound.archives.find(
        (archive) => archive.relativePath === "book.wikg",
      );

      expect(reboundArchive?.publicId).toBe(original?.publicId);
      expect(reboundArchive?.status).toBe("present");
      expect(rebound.archives).toHaveLength(1);
    });
  });

  it("does not silently adopt a rebind archive when mutation tokens conflict", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await ensureDefaultWikiGraphLibrary();
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      await createTestWikgArchive(
        tempDir,
        join(library.folderPath, "original.wikg"),
      );
      await copyFile(
        join(library.folderPath, "original.wikg"),
        join(library.folderPath, "copy.wikg"),
      );
      const first = await scanWikiGraphLibrary(target!);
      const original = first.archives.find(
        (archive) => archive.relativePath === "original.wikg",
      );
      const copy = first.archives.find(
        (archive) => archive.relativePath === "copy.wikg",
      );
      expect(original?.lastSeenMutationToken).toBe(copy?.lastSeenMutationToken);

      const newFolder = join(tempDir, "new-library-folder");
      await mkdir(newFolder);
      await copyFile(
        join(library.folderPath, "original.wikg"),
        join(newFolder, "renamed.wikg"),
      );
      const rebound = await rebindWikiGraphLibrary({
        folderPath: newFolder,
        target: target!,
      });
      const renamed = rebound.archives.find(
        (archive) => archive.relativePath === "renamed.wikg",
      );

      expect(renamed?.status).toBe("conflict");
      expect(renamed?.publicId).not.toBe(original?.publicId);
      expect(renamed?.publicId).not.toBe(copy?.publicId);
    });
  });

  it("rejects rebind on library archive URI targets", async () => {
    await withLibraryTestState(async (tempDir) => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const source = join(tempDir, "source.wikg");
      await writeFile(source, "content");
      const added = await addWikiGraphLibraryArchive({
        inputPath: source,
        target: target!,
      });
      const archiveTarget = parseWikiGraphLibraryUri(added.uri);
      expect(archiveTarget?.kind).toBe("archive");

      await expect(
        rebindWikiGraphLibrary({ folderPath: tempDir, target: archiveTarget! }),
      ).rejects.toThrow("requires a library scope URI");
    });
  });
});

async function getDefaultMetadata(
  target: NonNullable<ReturnType<typeof parseWikiGraphLibraryUri>>,
): Promise<Readonly<Record<string, unknown>>> {
  return await getWikiGraphLibraryMetadata(target);
}

describe("library URI locators", () => {
  it("separates library archives from library scopes", () => {
    expect(isWikiGraphLibraryUri("wikg://lib")).toBe(true);
    expect(isWikiGraphLibraryUri("wikg://lib/team.lib")).toBe(true);
    expect(isWikiGraphLibraryUri("wikg://lib/entity/Q23")).toBe(true);
    expect(isWikiGraphLibraryUri("wikg://lib/archive123/chapter")).toBe(false);
    expect(
      isWikiGraphLibraryUri("wikg://lib/team.lib/archive123/chapter"),
    ).toBe(false);

    expect(
      parseLocatedWikiGraphUri("wikg://lib/archive123/chapter"),
    ).toStrictEqual({
      archivePath: "wikg://lib/archive123",
      objectUri: "wikg://chapter",
    });
    expect(parseWikiGraphLibraryUri("wikg://lib/entity/Q23")).toMatchObject({
      isDefault: true,
      kind: "scope",
      objectUri: "wikg://entity/Q23",
    });
    expect(parseWikiGraphLibraryUri("wikg://lib/index")).toMatchObject({
      isDefault: true,
      kind: "scope",
      objectUri: "wikg://index",
    });
    expect(parseWikiGraphLibraryUri("wikg://lib/team.lib/index")).toMatchObject(
      {
        isDefault: false,
        kind: "scope",
        objectUri: "wikg://index",
        publicId: "team",
      },
    );
    expect(
      parseWikiGraphLibraryUri("wikg://lib/team.lib/archive123/entity"),
    ).toMatchObject({
      archivePublicId: "archive123",
      kind: "archive",
      objectUri: "wikg://entity",
      publicId: "team",
    });
  });

  it("resolves a library archive locator to the managed .wikg file", async () => {
    await withLibraryTestState(async (tempDir) => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const source = join(tempDir, "source.wikg");
      await writeFile(source, "content");

      const added = await addWikiGraphLibraryArchive({
        inputPath: source,
        target: target!,
        to: "nested/book.wikg",
      });

      await expect(resolveWikiGraphLibraryArchivePath(added.uri)).resolves.toBe(
        added.path,
      );
      await expect(
        resolveWikiGraphLibraryArchivePath(`${added.uri}-missing`),
      ).rejects.toThrow("Unknown Wiki Graph library archive");
    });
  });
});

async function withLibraryTestState(
  operation: (tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "wikigraph-library-test-"));

  try {
    await withWikiGraphStateDirectoryPathForTesting(
      join(tempDir, "state"),
      async () => {
        await operation(tempDir);
      },
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function createTestWikgArchive(
  tempDir: string,
  path: string,
): Promise<void> {
  const sourceDir = await mkdtemp(join(tempDir, "wikg-source-"));
  await writeFile(join(sourceDir, "database.db"), "test", "utf8");
  await writeWikgArchive(sourceDir, path);
}

async function createEmbeddedSearchIndexArchive(
  tempDir: string,
  path: string,
): Promise<void> {
  const sourceDir = await mkdtemp(join(tempDir, "wikg-source-"));
  const document = await DirectoryDocument.open(sourceDir);

  try {
    await setFtsIndexEmbedded(document, true);
    await rebuildArchiveSearchIndex(document);
  } finally {
    await document.release();
  }

  await writeWikgArchive(sourceDir, path);
  await expect(readWikgArchiveEntry(path, "fts.db")).resolves.toBeDefined();
}

async function createSearchableArchiveWithoutSearchIndex(
  tempDir: string,
  path: string,
): Promise<void> {
  const sourceDir = await mkdtemp(join(tempDir, "wikg-source-"));
  const document = await DirectoryDocument.open(sourceDir);

  try {
    await document.openSession(async (openedDocument) => {
      await openedDocument.createSerial();
      const draft = await openedDocument.getSerialFragments(1).createDraft();
      draft.addSentence("Libraryless archive data remains searchable.", 5);
      await draft.commit();
      await openedDocument.writeToc({
        items: [{ children: [], serialId: 1, title: "Libraryless" }],
        version: 1,
      });
    });
  } finally {
    await document.release();
  }

  await writeWikgArchive(sourceDir, path);
  await expect(readWikgArchiveEntry(path, "fts.db")).resolves.toBeUndefined();
}

async function readArchiveFtsEmbedded(path: string): Promise<boolean> {
  return await new WikiGraphArchiveFile(path).readDocument(
    async (document) => (await readArchiveIndexSettings(document)).ftsEmbedded,
  );
}

async function inspectFileState(path: string): Promise<{
  readonly mtimeMs: number;
  readonly mutationToken?: string;
  readonly size: number;
}> {
  const fileStat = await stat(path);
  const mutationToken = await readWikgArchiveMutationToken(path);
  return {
    mtimeMs: fileStat.mtimeMs,
    mutationToken,
    size: fileStat.size,
  };
}

async function insertStaleStateLock(libraryId: number): Promise<void> {
  const database = await Database.open(
    resolveWikiGraphCoreDatabasePath(),
    `
      CREATE TABLE IF NOT EXISTS state_locks (
        scope TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        mode TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (scope, resource_key, owner_id)
      );
    `,
  );

  try {
    const staleAt = Date.now() - 10 * 60 * 1000;
    await database.run(
      `
        INSERT INTO state_locks (
          scope, resource_key, mode, owner_id, owner_pid, heartbeat_at, created_at
        ) VALUES ('library', ?, 'write', 'stale-owner', 999999, ?, ?)
      `,
      [String(libraryId), staleAt, staleAt],
    );
  } finally {
    await database.close();
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
