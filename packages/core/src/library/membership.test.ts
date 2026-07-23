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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addWikiGraphLibraryArchive,
  ensureDefaultWikiGraphLibrary,
  isWikiGraphLibraryUri,
  moveWikiGraphLibraryArchive,
  parseLocatedWikiGraphUri,
  parseWikiGraphLibraryUri,
  removeWikiGraphLibraryArchive,
  resolveWikiGraphLibraryArchivePath,
  scanWikiGraphLibrary,
} from "../index.js";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../runtime/common/wiki-graph/dir.js";
import { writeWikgArchive } from "../storage/wikg/index.js";

let previousStateDir: string | undefined;
let tempDir: string;

beforeEach(async () => {
  previousStateDir = getWikiGraphStateDirectoryPathForTesting();
  tempDir = await mkdtemp(join(tmpdir(), "wikigraph-library-test-"));
  setWikiGraphStateDirectoryPathForTesting(join(tempDir, "state"));
});

afterEach(async () => {
  setWikiGraphStateDirectoryPathForTesting(previousStateDir);
  await rm(tempDir, { force: true, recursive: true });
});

describe("library archive membership", () => {
  it("scans nested .wikg files and reports missing registered files", async () => {
    const library = await ensureDefaultWikiGraphLibrary();
    await mkdir(join(library.folderPath, "nested"), { recursive: true });
    await writeFile(join(library.folderPath, "a.wikg"), "a");
    await writeFile(join(library.folderPath, "nested", "b.wikg"), "b");

    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const first = await scanWikiGraphLibrary(target!);
    expect(first.archives.map((archive) => archive.relativePath)).toStrictEqual(
      ["a.wikg", "nested/b.wikg"],
    );

    await rm(join(library.folderPath, "a.wikg"));
    const second = await scanWikiGraphLibrary(target!);
    expect(
      second.archives.map((archive) => ({
        relativePath: archive.relativePath,
        status: archive.status,
      })),
    ).toContainEqual({ relativePath: "a.wikg", status: "missing" });
  });

  it("adopts a moved archive only when its mutation token uniquely matches a missing member", async () => {
    const library = await ensureDefaultWikiGraphLibrary();
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    await createTestWikgArchive(join(library.folderPath, "old.wikg"));

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

  it("reports copied-token conflicts instead of silently reusing an archive id", async () => {
    const library = await ensureDefaultWikiGraphLibrary();
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    await createTestWikgArchive(join(library.folderPath, "original.wikg"));
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

  it("does not adopt by basename, size, or mtime without a mutation-token match", async () => {
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
      expect.objectContaining({ relativePath: "old.wikg", status: "missing" }),
    );
  });

  it("adds, moves, and removes managed archives inside the library folder", async () => {
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

async function createTestWikgArchive(path: string): Promise<void> {
  const sourceDir = await mkdtemp(join(tempDir, "wikg-source-"));
  await writeFile(join(sourceDir, "database.db"), "test", "utf8");
  await writeWikgArchive(sourceDir, path);
}
