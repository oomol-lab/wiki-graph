import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  symlink,
  rename,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installWikiGraphPlatform,
  parseWikiGraphLibraryUri,
  replaceChapterFtsIndexArtifact,
  assertArchiveIndexArtifactsReady,
  WikiGraphDirectoryFile,
} from "wiki-graph-core";
import { Database } from "../../core/src/document/database.js";
import { assertWikiGraphLibraryIndexReady } from "../../core/src/library/search-index.js";
import { runWikiGraphCLICaptured } from "../../cli/src/app/runner.js";
import {
  createWikiGraphSDK,
  isWikiGraphSchemaVersionError,
  WikiGraphSchemaVersionError,
} from "./index.js";
import {
  NodeDirectory,
  NodeFile,
  nodeWikiGraphPlatform,
} from "./node-platform.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  installWikiGraphPlatform(nodeWikiGraphPlatform);
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wikigraph-access-boundary-"));
  roots.push(root);
  const stateDir = join(root, "state");
  return { root, stateDir, sdk: createWikiGraphSDK({ cwd: root, stateDir }) };
}
async function setHomeVersion(stateDir: string, version: number) {
  await mkdir(stateDir, { recursive: true });
  const database = await Database.open(
    new NodeFile(join(stateDir, "core.sqlite")),
    "CREATE TABLE IF NOT EXISTS schema_versions(scope TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL)",
    { create: true, mode: "readwrite" },
  );
  try {
    await database.run(
      "INSERT OR REPLACE INTO schema_versions VALUES ('home', ?, 'fixture')",
      [version],
    );
  } finally {
    await database.close();
  }
}

describe("schema gate and bounded access", () => {
  it("recognizes intact cross-package/serialized version errors without classifying other failures", () => {
    const error = new WikiGraphSchemaVersionError({ kind: "home" }, 4, 5);
    expect(isWikiGraphSchemaVersionError(error)).toBe(true);
    expect(
      isWikiGraphSchemaVersionError(JSON.parse(JSON.stringify(error))),
    ).toBe(true);
    expect(isWikiGraphSchemaVersionError(new Error(error.message))).toBe(false);
    expect(
      isWikiGraphSchemaVersionError({ ...error, reason: "newer-version" }),
    ).toBe(false);
    expect(
      isWikiGraphSchemaVersionError({ ...error, actualVersion: NaN }),
    ).toBe(false);
    expect(
      isWikiGraphSchemaVersionError({ ...error, target: { kind: "archive" } }),
    ).toBe(false);
  });

  it("does no constructor I/O and never upgrades old Home until explicitly requested", async () => {
    const { stateDir, sdk } = await fixture();
    await setHomeVersion(stateDir, 4);
    const before = await readFile(join(stateDir, "core.sqlite"));
    await expect(sdk.libraries.list()).rejects.toMatchObject({
      code: "schema_version_incompatible",
      target: { kind: "home" },
      actualVersion: 4,
      supportedVersion: 5,
      reason: "upgrade-required",
    });
    expect(await readFile(join(stateDir, "core.sqlite"))).toEqual(before);
    await sdk.maintenance.upgrade({ kind: "home" });
    await expect(sdk.libraries.list()).resolves.toBeDefined();
    // The same runtime must recheck a rewritten resource.
    await setHomeVersion(stateDir, 99);
    await expect(sdk.libraries.list()).rejects.toMatchObject({
      actualVersion: 99,
      reason: "newer-version",
    });
    sdk.close();
  });

  it("initializes a fresh Home but preserves corrupt SQLite as a non-version failure", async () => {
    const { stateDir, sdk } = await fixture();
    const open = vi.spyOn(nodeWikiGraphPlatform.database, "open");
    const other = createWikiGraphSDK({ stateDir });
    expect(open).not.toHaveBeenCalled();
    await other.libraries.list();
    await rm(join(stateDir, "core.sqlite"));
    await writeFile(join(stateDir, "core.sqlite"), "not a sqlite database");
    const failure = await sdk.libraries.list().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(isWikiGraphSchemaVersionError(failure)).toBe(false);
    expect(await readFile(join(stateDir, "core.sqlite"), "utf8")).toBe(
      "not a sqlite database",
    );
    other.close();
    sdk.close();
  });

  it("explicitly upgrades v4 membership and preserves UUIDs and indexed ownership aliases", async () => {
    const { root, stateDir, sdk } = await fixture();
    const path = join(root, "book.wikg");
    await sdk.archives.create({ path });
    const library = await sdk.libraries.create(join(root, "library"));
    const member = await sdk.libraries.addArchive({
      inputPath: path,
      target: library.uri,
    });
    const archive = await sdk.archives.open({
      kind: "library",
      uri: member.uri,
    });
    await archive.putMetadata("", "title", "Survives migration");
    const core = await Database.open(
      new NodeFile(join(stateDir, "core.sqlite")),
      "",
      { create: false, mode: "readwrite" },
    );
    try {
      await core.execute(`DROP INDEX idx_libraries_physical_identity;
        DROP INDEX idx_library_archives_physical_identity;
        ALTER TABLE libraries DROP COLUMN physical_identity;
        ALTER TABLE library_archives DROP COLUMN physical_identity;
        UPDATE schema_versions SET version = 4 WHERE scope = 'home';`);
    } finally {
      await core.close();
    }
    await expect(
      sdk.archives.open({ kind: "library", uri: member.uri }),
    ).rejects.toMatchObject({
      reason: "upgrade-required",
      target: { kind: "home" },
    });
    await sdk.maintenance.upgrade({ kind: "home" });
    const upgraded = await sdk.libraries.getArchive(member.uri);
    expect(upgraded.publicId).toBe(member.publicId);
    const reopened = await sdk.archives.open({
      kind: "library",
      uri: member.uri,
    });
    expect(await reopened.getMetadata("")).toMatchObject({
      title: "Survives migration",
    });
    const alias = join(root, "alias.wikg");
    await symlink(join(root, "library", upgraded.relativePath), alias);
    await expect(
      sdk.archives.open({ kind: "standalone", path: alias }),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH" });
    await sdk.maintenance.upgrade({ kind: "home" });
    expect((await sdk.libraries.getArchive(member.uri)).publicId).toBe(
      member.publicId,
    );
    sdk.close();
  });

  it.each([4, 99])(
    "checks a standalone ZIP manifest before returning a handle (v%s)",
    async (version) => {
      const { root, sdk } = await fixture();
      const path = join(root, "versioned.wikg");
      await nodeWikiGraphPlatform.zip.write(new NodeFile(path), [
        {
          name: "manifest.json",
          data: new TextEncoder().encode(
            JSON.stringify({ formatVersion: 1, schemaVersion: version }),
          ),
        },
      ]);
      const before = await readFile(path);
      await expect(
        sdk.archives.open({ kind: "standalone", path }),
      ).rejects.toMatchObject({
        code: "schema_version_incompatible",
        actualVersion: version,
        supportedVersion: 5,
        target: { kind: "archive", path },
        reason: version < 5 ? "upgrade-required" : "newer-version",
      });
      expect(await readFile(path)).toEqual(before);
      sdk.close();
    },
  );

  it("preserves manifest damage and access errors instead of reporting upgrade-required", async () => {
    const { root, sdk } = await fixture();
    const path = join(root, "damaged.wikg");
    await nodeWikiGraphPlatform.zip.write(new NodeFile(path), [
      { name: "manifest.json", data: new TextEncoder().encode("broken JSON") },
    ]);
    const malformed = await sdk.archives
      .open({ kind: "standalone", path })
      .catch((error: unknown) => error);
    expect(malformed).toBeInstanceOf(Error);
    expect(isWikiGraphSchemaVersionError(malformed)).toBe(false);
    const denied = Object.assign(new Error("access denied"), {
      code: "EACCES",
    });
    const restricted = createWikiGraphSDK({
      host: {
        stateDir: join(root, "state"),
        platform: {
          ...nodeWikiGraphPlatform,
          zip: {
            ...nodeWikiGraphPlatform.zip,
            open: () => Promise.reject(denied),
          },
        },
      },
    });
    await expect(
      restricted.archives.open({ kind: "standalone", path }),
    ).rejects.toBe(denied);
    expect(isWikiGraphSchemaVersionError(denied)).toBe(false);
    restricted.close();
    sdk.close();
  });

  it.each(["text", "json", "jsonl"] as const)(
    "reports old Home and keeps rescue paths reachable (%s)",
    async (format) => {
      const { stateDir, sdk } = await fixture();
      await setHomeVersion(stateDir, 4);
      const result = await runWikiGraphCLICaptured({
        stateDir,
        argv: [
          "wikg://lib/arc",
          "scan",
          ...(format === "text" ? [] : [`--${format}`]),
        ],
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toContain("maintenance upgrade");
      if (format !== "text")
        expect(result.stderr + result.stdout).toContain(
          "schema_version_incompatible",
        );
      expect(
        (await runWikiGraphCLICaptured({ stateDir, argv: ["--version"] }))
          .exitCode,
      ).toBe(0);
      expect(
        (
          await runWikiGraphCLICaptured({
            stateDir,
            argv: ["maintenance", "upgrade", "--help"],
          })
        ).exitCode,
      ).toBe(0);
      sdk.close();
    },
  );

  it("directory opening and readiness do not enumerate unrelated entries or copy the SQLite", async () => {
    const { root, sdk } = await fixture();
    const path = join(root, "book.wikg");
    await sdk.archives.create({ path });
    const library = await sdk.libraries.create(join(root, "library"));
    const member = await sdk.libraries.addArchive({
      target: library.uri,
      inputPath: path,
    });
    const record = await sdk.libraries.getArchive(member.uri);
    const directoryPath = join(root, "library", record.relativePath);
    const archive = await sdk.archives.open({
      kind: "library",
      uri: member.uri,
    });
    const chapter = await archive.addChapter({
      title: "Indexed",
      source: "Needle in the book.",
    });
    await sdk.run(async () =>
      new WikiGraphDirectoryFile(new NodeDirectory(directoryPath)).write(
        async (document) => {
          await replaceChapterFtsIndexArtifact(document, chapter.chapterId);
        },
      ),
    );
    await archive.ensureSearchIndex();
    await sdk.libraries.scan(library.uri);
    await sdk.libraries.rebuildIndex(library.uri);
    const alias = join(root, "alias.wikg");
    await symlink(directoryPath, alias);
    await expect(
      sdk.archives.open({ kind: "standalone", path: alias }),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH" });
    const list = vi.spyOn(NodeDirectory.prototype, "list");
    let cacheBytesRead = 0;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with the original receiver via call below.
    const originalOpenReader = NodeFile.prototype.openReader;
    const reader = vi
      .spyOn(NodeFile.prototype, "openReader")
      .mockImplementation(async function (this: NodeFile) {
        const opened = await originalOpenReader.call(this);
        const isCache =
          this.path.includes("/.wikg-cache/") &&
          this.path.endsWith("/index.db");
        return {
          ...opened,
          read: async (offset, length) => {
            if (isCache) cacheBytesRead += length;
            return await opened.read(offset, length);
          },
        };
      });
    const queryAll = vi.spyOn(Database.prototype, "queryAll");
    const probe = async () => {
      list.mockClear();
      reader.mockClear();
      queryAll.mockClear();
      cacheBytesRead = 0;
      await sdk.libraries.get(library.uri);
      await sdk.run(async () =>
        assertWikiGraphLibraryIndexReady(
          parseWikiGraphLibraryUri(library.uri)!,
        ),
      );
      // No matches means result hydration cannot mask a preflight scan.
      await sdk.libraries.search(library.uri, "absentuniqueterm", {
        queryMode: "fts",
        skipUnindexed: true,
      });
      const opened = await sdk.archives.open({
        kind: "library",
        uri: member.uri,
      });
      await opened.getMetadata("");
      await opened.search("absentuniqueterm", {
        queryMode: "fts",
        chapters: [chapter.chapterId],
      });
      expect(
        list.mock.contexts.filter((directory) =>
          (directory as NodeDirectory).path.startsWith(directoryPath),
        ),
      ).toHaveLength(0);
      expect(cacheBytesRead).toBe(0);
      expect(
        reader.mock.contexts.filter(
          (file) =>
            (file as NodeFile).path === join(directoryPath, "database.db"),
        ),
      ).toHaveLength(0);
      expect(
        queryAll.mock.calls.some(
          ([sql]) =>
            /FROM library_archives[\s\S]*WHERE library_id = \?/u.test(sql) &&
            !/\bid = \?/u.test(sql),
        ),
      ).toBe(false);
      return {
        lists: list.mock.calls.length,
        reads: reader.mock.calls.length,
        queries: queryAll.mock.calls.length,
      };
    };
    const small = await probe();
    for (let i = 0; i < 60; i += 1)
      await writeFile(join(directoryPath, `unrelated-${i}.txt`), "unused");
    const largerDirectory = await probe();
    expect(largerDirectory.lists).toBeLessThanOrEqual(small.lists);
    expect(largerDirectory.reads).toBeLessThanOrEqual(small.reads);
    expect(largerDirectory.queries).toBeLessThanOrEqual(small.queries);
    for (let i = 0; i < 6; i += 1) {
      await sdk.libraries.addArchive({
        target: library.uri,
        inputPath: path,
        to: `extra-${i}.wikg`,
      });
    }
    await sdk.libraries.rebuildIndex(library.uri);
    const largerLibrary = await probe();
    expect(largerLibrary.lists).toBeLessThanOrEqual(small.lists);
    expect(largerLibrary.reads).toBeLessThanOrEqual(small.reads);
    expect(largerLibrary.queries).toBeLessThanOrEqual(small.queries);
    for (let i = 0; i < 12; i += 1)
      await archive.addChapter({ title: `Unrelated ${i}` });
    await archive.ensureSearchIndex({ chapters: [chapter.chapterId] });
    await sdk.libraries.rebuildIndex(library.uri);
    const largerChapterCount = await probe();
    expect(largerChapterCount.lists).toBeLessThanOrEqual(small.lists);
    expect(largerChapterCount.reads).toBeLessThanOrEqual(small.reads);
    expect(largerChapterCount.queries).toBeLessThanOrEqual(small.queries);
    // Local FTS coverage must be pushed into SQL and never inspect embeddings.
    await sdk.run(async () =>
      new WikiGraphDirectoryFile(new NodeDirectory(directoryPath)).readDocument(
        async (document) => {
          const coverage = vi.spyOn(document.indexArtifacts, "listCoverage");
          await assertArchiveIndexArtifactsReady(document, {
            chapters: [chapter.chapterId],
            queryMode: "fts",
          });
          expect(coverage.mock.calls).toEqual([["fts", [chapter.chapterId]]]);
        },
      ),
    );
    // Access-time manifest validation is not a permanently memoized success.
    const manifestPath = join(directoryPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, schemaVersion: 99 }),
    );
    await expect(archive.getMetadata("")).rejects.toMatchObject({
      code: "schema_version_incompatible",
      reason: "newer-version",
      target: { kind: "library", uri: library.uri },
    });
    await expect(
      sdk.libraries.search(library.uri, "needle", {
        queryMode: "fts",
        skipUnindexed: true,
      }),
    ).rejects.toMatchObject({
      reason: "newer-version",
      target: { kind: "library", uri: library.uri },
    });
    const consume = vi.fn();
    await expect(
      sdk.libraries.readArchive(member.uri, consume),
    ).rejects.toMatchObject({
      reason: "newer-version",
      target: { kind: "library", uri: library.uri },
    });
    expect(consume).not.toHaveBeenCalled();
    sdk.close();
  });

  it("ZIP schema validation reads only manifest and session readers are released", async () => {
    const { root, stateDir, sdk } = await fixture();
    const path = join(root, "book.wikg");
    await sdk.archives.create({ path });
    let opened = 0;
    let closed = 0;
    const reads: string[] = [];
    const lists: string[] = [];
    const tracked = createWikiGraphSDK({
      host: {
        stateDir,
        platform: {
          ...nodeWikiGraphPlatform,
          zip: {
            ...nodeWikiGraphPlatform.zip,
            open: async (file) => {
              opened += 1;
              const reader = await nodeWikiGraphPlatform.zip.open(file);
              return {
                ...reader,
                close: async () => {
                  closed += 1;
                  await reader.close();
                },
                listEntries: async () => {
                  lists.push(file.identity);
                  return await reader.listEntries();
                },
                readEntry: async (name) => {
                  reads.push(name);
                  return await reader.readEntry(name);
                },
              };
            },
          },
        },
      },
    });
    const archive = await tracked.archives.open({ kind: "standalone", path });
    expect(reads).toEqual(["manifest.json"]);
    expect(opened).toBe(closed);
    opened = 0;
    closed = 0;
    reads.length = 0;
    await archive.getMetadata("");
    expect(lists).toEqual([]);
    expect(opened).toBe(closed);
    expect(opened).toBeLessThanOrEqual(2);
    tracked.close();
    sdk.close();
  });

  it("retains managed path ownership when a registered directory is replaced externally", async () => {
    const { root, sdk } = await fixture();
    const folder = join(root, "library");
    await sdk.libraries.create(folder);
    await rename(folder, join(root, "previous-library"));
    await mkdir(folder);
    await expect(
      sdk.archives.create({ path: join(folder, "unregistered.wikg") }),
    ).rejects.toMatchObject({ code: "WIKI_GRAPH_ARCHIVE_OWNERSHIP_MISMATCH" });
    sdk.close();
  });
});
