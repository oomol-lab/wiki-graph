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
  writeWikgArchive,
  writeWikgArchiveWithOverlays,
} from "../../../../packages/core/src/storage/wikg/archive/index.js";
import { withTempDir } from "../../../helpers/temp.js";

const VALID_MUTATION_TOKEN_CONTENT = `wikg-mutation-token:v1\n${"a".repeat(43)}\n`;

describe("wikg/archive", () => {
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
      ).toEqual({ formatVersion: 1 });
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
        await writeFile(`${sourceDir}/fts.db`, "fts", "utf8");
      } finally {
        await document.release();
      }

      await writeWikgArchive(sourceDir, archivePath);

      await expect(readWikgArchiveEntry(archivePath, "fts.db")).resolves.toBe(
        undefined,
      );
    });
  });

  it("includes embedded FTS databases in new archives", async () => {
    await withTempDir("wikigraph-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/book.wikg`;
      const document = await DirectoryDocument.open(sourceDir);

      try {
        await document.readDatabase(async (database) => {
          await database.run(
            `
              INSERT INTO archive_index_settings(id, fts_embedded)
              VALUES (1, 1)
              ON CONFLICT(id)
              DO UPDATE SET fts_embedded = excluded.fts_embedded
            `,
          );
        });
        await writeFile(`${sourceDir}/fts.db`, "fts", "utf8");
      } finally {
        await document.release();
      }

      await writeWikgArchive(sourceDir, archivePath);

      await expect(
        readWikgArchiveEntry(archivePath, "fts.db"),
      ).resolves.toEqual(Buffer.from("fts", "utf8"));
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
      ).toEqual({ formatVersion: 1 });
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
          workspacePath: `${sourceDir}/database.db`,
        },
      ]);

      const after = await readWikgArchiveMutationToken(rewrittenPath);

      expect(after).not.toBe(before);
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
