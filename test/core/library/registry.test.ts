import { mkdtemp, rm, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearWikiGraphLibraryMetadata,
  createWikiGraphLibrary,
  deleteWikiGraphLibraryMetadataKey,
  ensureDefaultWikiGraphLibrary,
  formatWikiGraphLibraryUri,
  getWikiGraphLibraryMetadata,
  listWikiGraphLibraryScope,
  parseLocatedWikiGraphUri,
  parseWikiGraphLibraryUri,
  putWikiGraphLibraryMetadata,
  removeWikiGraphLibrary,
  replaceWikiGraphLibraryMetadata,
} from "../../../packages/core/src/index.js";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../packages/core/src/runtime/common/wiki-graph/dir.js";

describe("wiki graph library registry", () => {
  const originalStateDir = getWikiGraphStateDirectoryPathForTesting();
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "wikg-library-"));
    setWikiGraphStateDirectoryPathForTesting(stateDir);
  });

  afterEach(async () => {
    setWikiGraphStateDirectoryPathForTesting(originalStateDir);
    await rm(stateDir, { force: true, recursive: true });
  });

  it("auto-creates the default library with empty metadata", async () => {
    const library = await ensureDefaultWikiGraphLibrary();

    expect(library.id).toEqual(expect.any(Number));
    expect(library.isDefault).toBe(true);
    expect(library.uri).toBe("wikg://lib");
    expect(library.folderPath).toBe(join(stateDir, "default-library"));
    expect((await stat(library.folderPath)).isDirectory()).toBe(true);
    expect(
      await getWikiGraphLibraryMetadata({ isDefault: true, kind: "metadata" }),
    ).toStrictEqual({});
  });

  it("reuses one default library across concurrent first-run callers", async () => {
    const libraries = await Promise.all(
      Array.from(
        { length: 8 },
        async () => await ensureDefaultWikiGraphLibrary(),
      ),
    );

    expect(new Set(libraries.map((library) => library.id)).size).toBe(1);
    expect(new Set(libraries.map((library) => library.publicId)).size).toBe(1);
    expect((await stat(libraries[0]!.folderPath)).isDirectory()).toBe(true);
  });

  it("creates non-default libraries with public .lib URIs and refuses existing folders", async () => {
    const folderPath = join(stateDir, "research");
    const library = await createWikiGraphLibrary({ folderPath });

    expect(library.id).toEqual(expect.any(Number));
    expect(Number.isInteger(library.id)).toBe(true);
    expect(library.publicId).toMatch(/^[0-9a-f]{12}$/u);
    expect(library.uri).toBe(`wikg://lib/${library.publicId}.lib`);
    expect(formatWikiGraphLibraryUri(library.publicId)).toBe(library.uri);
    expect((await stat(folderPath)).isDirectory()).toBe(true);
    await expect(createWikiGraphLibrary({ folderPath })).rejects.toThrow(
      "Library folder already exists",
    );
  });

  it("parses library URIs without stealing .wikg archive URIs", () => {
    expect(parseWikiGraphLibraryUri("wikg://lib")).toStrictEqual({
      isDefault: true,
      kind: "scope",
    });
    expect(
      parseWikiGraphLibraryUri("wikg://lib/abc123abc123.lib/meta"),
    ).toStrictEqual({
      isDefault: false,
      kind: "metadata",
      publicId: "abc123abc123",
    });
    expect(
      parseWikiGraphLibraryUri("wikg://lib/archive123/chapter"),
    ).toStrictEqual({
      archivePublicId: "archive123",
      isDefault: true,
      kind: "archive",
      objectUri: "wikg://chapter",
    });
    expect(parseWikiGraphLibraryUri("wikg://lib/entity/Q42")).toStrictEqual({
      isDefault: true,
      kind: "scope",
      objectUri: "wikg://entity/Q42",
    });
    const parsed = parseLocatedWikiGraphUri(
      "wikg://tmp/lib/book.wikg/entity/Q42",
    );
    expect(parsed.archivePath).toContain("tmp/lib/book.wikg");
    expect(parsed.objectUri).toBe("wikg://entity/Q42");
  });

  it("supports metadata put, set, delete, and clear while rejecting system fields", async () => {
    const library = await createWikiGraphLibrary({
      folderPath: join(stateDir, "metadata-library"),
    });
    const target = parseWikiGraphLibraryUri(`${library.uri}/meta`)!;

    expect(
      await putWikiGraphLibraryMetadata(target, "title", "Research"),
    ).toStrictEqual({
      title: "Research",
    });
    expect(
      await putWikiGraphLibraryMetadata(target, "description", "Notes"),
    ).toStrictEqual({ description: "Notes", title: "Research" });
    expect(
      await replaceWikiGraphLibraryMetadata(target, { title: "Only title" }),
    ).toStrictEqual({ title: "Only title" });
    await expect(
      putWikiGraphLibraryMetadata(target, "folder_path", "/tmp"),
    ).rejects.toThrow("system field");
    expect(
      await deleteWikiGraphLibraryMetadataKey(target, "title"),
    ).toStrictEqual({});
    expect(await clearWikiGraphLibraryMetadata(target)).toStrictEqual({});
  });

  it("removes only registry records and keeps folders; default removal is rejected", async () => {
    const library = await createWikiGraphLibrary({
      folderPath: join(stateDir, "kept"),
    });
    const target = parseWikiGraphLibraryUri(library.uri)!;

    expect(await listWikiGraphLibraryScope(target)).toStrictEqual([]);
    expect((await removeWikiGraphLibrary(target)).uri).toBe(library.uri);
    await expect(stat(library.folderPath)).resolves.toBeTruthy();
    await expect(
      removeWikiGraphLibrary({ isDefault: true, kind: "scope" }),
    ).rejects.toThrow("default library");
    await expect(listWikiGraphLibraryScope(target)).rejects.toThrow(
      "Unknown Wiki Graph library",
    );
  });
});
