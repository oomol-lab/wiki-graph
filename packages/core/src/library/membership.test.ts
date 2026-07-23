import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";

import {
  addWikiGraphLibraryArchive,
  createWikiGraphLibrary,
  ensureDefaultWikiGraphLibrary,
  getWikiGraphLibraryMetadata,
  isWikiGraphLibraryUri,
  moveWikiGraphLibraryArchive,
  parseLocatedWikiGraphUri,
  parseWikiGraphLibraryUri,
  putWikiGraphLibraryMetadata,
  rebindWikiGraphLibrary,
  removeWikiGraphLibrary,
  removeWikiGraphLibraryArchive,
  resolveWikiGraphLibraryArchivePath,
  resolveWikiGraphLibrary,
  scanWikiGraphLibrary,
} from "../index.js";
import { withWikiGraphStateDirectoryPathForTesting } from "../runtime/common/wiki-graph/dir.js";
import { writeWikgArchive } from "../storage/wikg/index.js";
import { acquireWikiGraphLibraryLock } from "./lock.js";

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

  it("requires the library write lock when removing a library registry", async () => {
    await withLibraryTestState(async (tempDir) => {
      const library = await createWikiGraphLibrary({
        folderPath: join(tempDir, "locked-library"),
      });
      const target = parseWikiGraphLibraryUri(library.uri);
      expect(target).toBeDefined();
      const release = await acquireWikiGraphLibraryLock(library.id, "write");

      try {
        await expect(removeWikiGraphLibrary(target!)).rejects.toThrow(
          `Wiki Graph library is locked for write: ${library.id}.`,
        );
      } finally {
        await release();
      }

      await expect(removeWikiGraphLibrary(target!)).resolves.toMatchObject({
        id: library.id,
      });
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
