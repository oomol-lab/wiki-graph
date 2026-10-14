import { createWriteStream } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { finished } from "stream/promises";
import { ZipFile } from "yazl";

import { describe, expect, it } from "vitest";

import { DirectoryDocument } from "../../../../packages/core/src/document/index.js";
import {
  extractWikgArchive,
  readWikgArchiveMutationToken,
  readWikgArchiveEntry,
  listWikgArchiveEntries,
  WikgArchiveReader,
  writeWikgArchive,
  writeWikgArchiveWithOverlays,
} from "../../../../packages/core/src/storage/wikg/archive/index.js";
import { withTempDir } from "../../../helpers/temp.js";
import {
  NodeFile,
  nodeWikiGraphPlatform,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { readWikiGraphArchiveSchemaVersion } from "../../../../packages/core/src/storage/schema-upgrade/index.js";

const VALID_MUTATION_TOKEN_CONTENT = `wikg-mutation-token:v1\n${"a".repeat(43)}\n`;

describe("wikg/archive", () => {
  it.each([
    { names: ["toc.json", "./toc.json"], expected: "value-1" },
    { names: ["./toc.json", "toc.json"], expected: "value-1" },
    { names: ["toc.json", "./toc.json", "toc.json"], expected: "value-1" },
    {
      names: ["toc.json", "./toc.json", ".//toc.json", "./toc.json"],
      expected: "value-2",
    },
    { names: ["./toc.json", "./toc.json"], expected: "value-1" },
  ])(
    "preserves normalized ZIP lookup precedence for $names",
    async ({ names, expected }) => {
      await withTempDir("wikigraph-archive-alias-", async (path) => {
        const file = new NodeFile(`${path}/book.wikg`);
        const encode = (value: string) => new TextEncoder().encode(value);
        await nodeWikiGraphPlatform.zip.write(file, [
          {
            name: "manifest.json",
            data: encode('{"formatVersion":1,"schemaVersion":99}'),
          },
          {
            name: "./manifest.json",
            data: encode('{"formatVersion":1,"schemaVersion":5}'),
          },
          {
            name: ".wikg-mutation-token",
            data: encode(VALID_MUTATION_TOKEN_CONTENT),
          },
          ...names.map((name, index) => ({
            name,
            data: encode(`value-${index}`),
          })),
        ]);
        // The schema gate and archive reader must resolve the same manifest.
        expect(await readWikiGraphArchiveSchemaVersion(file)).toBe(5);
        const reader = await WikgArchiveReader.open(file);
        try {
          expect(await reader.listEntries()).toEqual([
            ".wikg-mutation-token",
            "manifest.json",
            "toc.json",
          ]);
          expect(
            new TextDecoder().decode(await reader.readEntry("toc.json")),
          ).toBe(expected);
          expect(
            new TextDecoder().decode(await reader.readEntry("./toc.json")),
          ).toBe(expected);
          expect(await reader.getEntrySize("toc.json")).toBe(
            encode(expected).length,
          );
          expect(await reader.readEntryRange("toc.json", 0, 5)).toEqual(
            encode("value"),
          );
          const copy = new NodeFile(`${path}/copy.txt`);
          expect(await reader.copyEntry("toc.json", copy)).toBe(true);
          expect(await readFile(`${path}/copy.txt`, "utf8")).toBe(expected);
        } finally {
          await reader.close();
        }
        expect(await listWikgArchiveEntries(file)).toEqual([
          ".wikg-mutation-token",
          "manifest.json",
          "toc.json",
        ]);
        await extractWikgArchive(file, `${path}/extracted`);
        expect(await readFile(`${path}/extracted/toc.json`, "utf8")).toBe(
          expected,
        );
      });
    },
  );

  it("writes and extracts only whitelisted wikg document files", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/result/book.wikg`;
      const extractDir = `${path}/extract`;

      await mkdir(`${sourceDir}/cover`, { recursive: true });
      await mkdir(`${sourceDir}/texts/source`, { recursive: true });
      await mkdir(`${sourceDir}/texts/summary`, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, "sqlite", "utf8");
      await writeFile(`${sourceDir}/database.db-journal`, "journal", "utf8");
      await writeFile(`${sourceDir}/ignored-meta.json`, "ignored", "utf8");
      await writeFile(`${sourceDir}/toc.json`, '{"items":[]}', "utf8");
      await writeFile(
        `${sourceDir}/cover/info.json`,
        '{"mediaType":"image/png"}',
        "utf8",
      );
      await writeFile(`${sourceDir}/cover/data.bin`, "cover-bytes", "utf8");
      await writeFile(`${sourceDir}/texts/source/1.txt`, "source", "utf8");
      await writeFile(`${sourceDir}/texts/source/note.txt`, "ignored", "utf8");
      await writeFile(`${sourceDir}/texts/summary/1.txt`, "summary", "utf8");
      await writeFile(`${sourceDir}/alpha.txt`, "ignored", "utf8");

      await writeWikgArchive(sourceDir, archivePath);
      await extractWikgArchive(archivePath, extractDir);

      expect(
        await readFile(`${extractDir}/.wikg-mutation-token`, "utf8"),
      ).toMatch(/^wikg-mutation-token:v1\n[A-Za-z0-9_-]{43}\n$/u);
      expect(
        JSON.parse(await readFile(`${extractDir}/manifest.json`, "utf8")),
      ).toEqual({ formatVersion: 1, schemaVersion: 5 });
      expect(await readFile(`${extractDir}/database.db`, "utf8")).toBe(
        "sqlite",
      );
      expect(await readFile(`${extractDir}/toc.json`, "utf8")).toContain(
        '"items":[]',
      );
      expect(await readFile(`${extractDir}/texts/source/1.txt`, "utf8")).toBe(
        "source",
      );
      expect(await readFile(`${extractDir}/texts/summary/1.txt`, "utf8")).toBe(
        "summary",
      );
      expect(await readFile(`${extractDir}/cover/data.bin`, "utf8")).toBe(
        "cover-bytes",
      );
      await expect(
        readFile(`${extractDir}/database.db-journal`, "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(`${extractDir}/ignored-meta.json`, "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(`${extractDir}/alpha.txt`, "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(`${extractDir}/texts/source/note.txt`, "utf8"),
      ).rejects.toThrow();
    });
  });

  it("omits external FTS databases from new archives", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/book.wikg`;
      const document = await DirectoryDocument.open(sourceDir);

      try {
        await writeFile(`${sourceDir}/index.db`, "fts", "utf8");
      } finally {
        await document.release();
      }

      await writeWikgArchive(sourceDir, archivePath);

      await expect(readWikgArchiveEntry(archivePath, "index.db")).resolves.toBe(
        undefined,
      );
    });
  });

  it("omits FTS databases even when old settings request embedded indexes", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/book.wikg`;
      const document = await DirectoryDocument.open(sourceDir);

      try {
        await document.readDatabase(async (database) => {
          await database.run(
            `
              CREATE TABLE archive_index_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                fts_embedded INTEGER NOT NULL DEFAULT 0
              )
            `,
          );
          await database.run(
            `
              INSERT INTO archive_index_settings(id, fts_embedded)
              VALUES (1, 1)
              ON CONFLICT(id)
              DO UPDATE SET fts_embedded = excluded.fts_embedded
            `,
          );
        });
        await writeFile(`${sourceDir}/index.db`, "fts", "utf8");
      } finally {
        await document.release();
      }

      await writeWikgArchive(sourceDir, archivePath);

      await expect(
        readWikgArchiveEntry(archivePath, "index.db"),
      ).resolves.toBeUndefined();
    });
  });

  it("creates parent directories for the output archive path", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/deep/output/book.wikg`;

      await mkdir(sourceDir, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, "chapter", "utf8");
      await writeWikgArchive(sourceDir, archivePath);

      await expect(readFile(archivePath)).resolves.toBeInstanceOf(Uint8Array);
      await extractWikgArchive(archivePath, `${path}/unpacked`);
      expect(await readFile(`${path}/unpacked/database.db`, "utf8")).toBe(
        "chapter",
      );
    });
  });

  it("reads a deflated archive entry without extracting the archive", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/book.wikg`;
      const databaseContent = "sqlite\n".repeat(2000);

      await mkdir(sourceDir, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, databaseContent, "utf8");
      await writeWikgArchive(sourceDir, archivePath);

      await expect(
        readWikgArchiveEntry(archivePath, "database.db"),
      ).resolves.toEqual(Buffer.from(databaseContent, "utf8"));
    });
  });

  it("keeps the manifest when overlays delete it", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/book.wikg`;
      const rewrittenPath = `${path}/rewritten.wikg`;
      const extractDir = `${path}/extract`;

      await mkdir(sourceDir, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, "sqlite", "utf8");
      await writeWikgArchive(sourceDir, archivePath);
      await writeWikgArchiveWithOverlays(archivePath, rewrittenPath, [
        { entryPath: "manifest.json", kind: "deleted" },
      ]);
      await extractWikgArchive(rewrittenPath, extractDir);

      expect(
        JSON.parse(await readFile(`${extractDir}/manifest.json`, "utf8")),
      ).toEqual({ formatVersion: 1, schemaVersion: 5 });
    });
  });

  it("refreshes the mutation token when overlays rewrite the archive", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/book.wikg`;
      const rewrittenPath = `${path}/rewritten.wikg`;

      await mkdir(sourceDir, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, "sqlite", "utf8");
      await writeWikgArchive(sourceDir, archivePath);

      const before = await readWikgArchiveMutationToken(archivePath);

      await writeWikgArchiveWithOverlays(archivePath, rewrittenPath, [
        {
          entryPath: "toc.json",
          kind: "file",
          file: new NodeFile(`${sourceDir}/database.db`),
        },
      ]);

      const after = await readWikgArchiveMutationToken(rewrittenPath);

      expect(after).not.toBe(before);
    });
  });

  it("drops legacy fts.db when unrelated overlays rewrite the archive", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const archivePath = `${path}/legacy.wikg`;
      const rewrittenPath = `${path}/rewritten.wikg`;
      const overlayPath = `${path}/toc.json`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(
        Buffer.from(VALID_MUTATION_TOKEN_CONTENT, "utf8"),
        ".wikg-mutation-token",
      );
      zipFile.addBuffer(
        Buffer.from('{"formatVersion":1,"schemaVersion":2}', "utf8"),
        "manifest.json",
      );
      zipFile.addBuffer(Buffer.from("sqlite", "utf8"), "database.db");
      zipFile.addBuffer(Buffer.from("legacy-index", "utf8"), "fts.db");
      await writeZipFile(zipFile, archivePath);
      await writeFile(overlayPath, '{"items":[]}', "utf8");

      await writeWikgArchiveWithOverlays(archivePath, rewrittenPath, [
        {
          entryPath: "toc.json",
          file: new NodeFile(overlayPath),
          kind: "file",
        },
      ]);

      await expect(
        readWikgArchiveEntry(rewrittenPath, "fts.db"),
      ).resolves.toBeUndefined();
    });
  });

  it("rejects archives that omit the mutation token", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const archivePath = `${path}/missing-token.wikg`;
      const extractDir = `${path}/extract`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(
        Buffer.from('{"formatVersion":1}', "utf8"),
        "manifest.json",
      );
      zipFile.addBuffer(Buffer.from("sqlite", "utf8"), "database.db");
      await writeZipFile(zipFile, archivePath);

      await expect(extractWikgArchive(archivePath, extractDir)).rejects.toThrow(
        "Missing WIKG mutation token: .wikg-mutation-token.",
      );
    });
  });

  it("rejects archives with malformed mutation tokens", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const archivePath = `${path}/malformed-token.wikg`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(
        Buffer.from("wikg-mutation-token:v1\nbad\n", "utf8"),
        ".wikg-mutation-token",
      );
      zipFile.addBuffer(
        Buffer.from('{"formatVersion":1}', "utf8"),
        "manifest.json",
      );
      zipFile.addBuffer(Buffer.from("sqlite", "utf8"), "database.db");
      await writeZipFile(zipFile, archivePath);

      await expect(
        extractWikgArchive(archivePath, `${path}/extract`),
      ).rejects.toThrow("Invalid WIKG mutation token: .wikg-mutation-token.");
    });
  });

  it("rejects archives that omit the manifest", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const archivePath = `${path}/missing-manifest.wikg`;
      const extractDir = `${path}/extract`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(
        Buffer.from(VALID_MUTATION_TOKEN_CONTENT, "utf8"),
        ".wikg-mutation-token",
      );
      zipFile.addBuffer(Buffer.from("sqlite", "utf8"), "database.db");
      await writeZipFile(zipFile, archivePath);

      await expect(extractWikgArchive(archivePath, extractDir)).rejects.toThrow(
        "Missing WIKG manifest: manifest.json.",
      );
    });
  });

  it("rejects archives with unsupported manifest versions", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const archivePath = `${path}/future.wikg`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(
        Buffer.from(VALID_MUTATION_TOKEN_CONTENT, "utf8"),
        ".wikg-mutation-token",
      );
      zipFile.addBuffer(
        Buffer.from('{"formatVersion":2}', "utf8"),
        "manifest.json",
      );
      zipFile.addBuffer(Buffer.from("sqlite", "utf8"), "database.db");
      await writeZipFile(zipFile, archivePath);

      await expect(
        extractWikgArchive(archivePath, `${path}/extract`),
      ).rejects.toThrow("Unsupported WIKG format version in manifest.json.");
    });
  });

  it("rejects archives with malformed manifest files", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const archivePath = `${path}/malformed.wikg`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(
        Buffer.from(VALID_MUTATION_TOKEN_CONTENT, "utf8"),
        ".wikg-mutation-token",
      );
      zipFile.addBuffer(Buffer.from("not json", "utf8"), "manifest.json");
      zipFile.addBuffer(Buffer.from("sqlite", "utf8"), "database.db");
      await writeZipFile(zipFile, archivePath);

      await expect(
        extractWikgArchive(archivePath, `${path}/extract`),
      ).rejects.toThrow();
    });
  });
});

async function writeZipFile(zipFile: ZipFile, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const output = createWriteStream(path);
  const outputDone = finished(output);
  const zipDone = finished(zipFile.outputStream);

  zipFile.outputStream.pipe(output);
  zipFile.end();
  await Promise.all([outputDone, zipDone]);
}
