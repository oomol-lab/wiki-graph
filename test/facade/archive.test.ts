import { createWriteStream } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { finished } from "stream/promises";
import { ZipFile } from "yazl";

import { describe, expect, it } from "vitest";

import {
  extractSdpubArchive,
  writeSdpubArchive,
} from "../../src/facade/archive.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/archive", () => {
  it("writes and extracts only whitelisted sdpub document files", async () => {
    await withTempDir("spinedigest-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/result/book.sdpub`;
      const extractDir = `${path}/extract`;

      await mkdir(`${sourceDir}/cover`, { recursive: true });
      await mkdir(`${sourceDir}/fragments/serial-1`, { recursive: true });
      await mkdir(`${sourceDir}/summaries`, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, "sqlite", "utf8");
      await writeFile(`${sourceDir}/database.db-journal`, "journal", "utf8");
      await writeFile(
        `${sourceDir}/book-meta.json`,
        '{"title":"Book"}',
        "utf8",
      );
      await writeFile(`${sourceDir}/toc.json`, '{"items":[]}', "utf8");
      await writeFile(
        `${sourceDir}/cover/info.json`,
        '{"mediaType":"image/png"}',
        "utf8",
      );
      await writeFile(`${sourceDir}/cover/data.bin`, "cover-bytes", "utf8");
      await writeFile(
        `${sourceDir}/fragments/serial-1/fragment_0.json`,
        '{"summary":"","sentences":[]}',
        "utf8",
      );
      await writeFile(
        `${sourceDir}/fragments/serial-1/note.txt`,
        "ignored",
        "utf8",
      );
      await writeFile(`${sourceDir}/summaries/serial-1.txt`, "summary", "utf8");
      await writeFile(`${sourceDir}/alpha.txt`, "ignored", "utf8");

      await writeSdpubArchive(sourceDir, archivePath);
      await extractSdpubArchive(archivePath, extractDir);

      expect(
        JSON.parse(await readFile(`${extractDir}/manifest.json`, "utf8")),
      ).toEqual({ formatVersion: 1 });
      expect(await readFile(`${extractDir}/database.db`, "utf8")).toBe(
        "sqlite",
      );
      expect(await readFile(`${extractDir}/book-meta.json`, "utf8")).toContain(
        '"title":"Book"',
      );
      expect(await readFile(`${extractDir}/toc.json`, "utf8")).toContain(
        '"items":[]',
      );
      expect(
        await readFile(
          `${extractDir}/fragments/serial-1/fragment_0.json`,
          "utf8",
        ),
      ).toContain('"sentences":[]');
      expect(
        await readFile(`${extractDir}/summaries/serial-1.txt`, "utf8"),
      ).toBe("summary");
      expect(await readFile(`${extractDir}/cover/data.bin`, "utf8")).toBe(
        "cover-bytes",
      );
      await expect(
        readFile(`${extractDir}/database.db-journal`, "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(`${extractDir}/alpha.txt`, "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(`${extractDir}/fragments/serial-1/note.txt`, "utf8"),
      ).rejects.toThrow();
    });
  });

  it("creates parent directories for the output archive path", async () => {
    await withTempDir("spinedigest-archive-", async (path) => {
      const sourceDir = `${path}/source`;
      const archivePath = `${path}/deep/output/book.sdpub`;

      await mkdir(sourceDir, { recursive: true });
      await writeFile(`${sourceDir}/database.db`, "chapter", "utf8");
      await writeSdpubArchive(sourceDir, archivePath);

      await expect(readFile(archivePath)).resolves.toBeInstanceOf(Uint8Array);
      await extractSdpubArchive(archivePath, `${path}/unpacked`);
      expect(await readFile(`${path}/unpacked/database.db`, "utf8")).toBe(
        "chapter",
      );
    });
  });

  it("rejects archives that omit the manifest", async () => {
    await withTempDir("spinedigest-archive-", async (path) => {
      const archivePath = `${path}/missing-manifest.sdpub`;
      const extractDir = `${path}/extract`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(Buffer.from("sqlite", "utf8"), "database.db");
      await writeZipFile(zipFile, archivePath);

      await expect(
        extractSdpubArchive(archivePath, extractDir),
      ).rejects.toThrow("Missing SDPUB manifest: manifest.json.");
    });
  });

  it("rejects archives with unsupported manifest versions", async () => {
    await withTempDir("spinedigest-archive-", async (path) => {
      const archivePath = `${path}/future.sdpub`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(
        Buffer.from('{"formatVersion":2}', "utf8"),
        "manifest.json",
      );
      zipFile.addBuffer(Buffer.from("sqlite", "utf8"), "database.db");
      await writeZipFile(zipFile, archivePath);

      await expect(
        extractSdpubArchive(archivePath, `${path}/extract`),
      ).rejects.toThrow("Unsupported SDPUB format version in manifest.json.");
    });
  });

  it("rejects archives with malformed manifest files", async () => {
    await withTempDir("spinedigest-archive-", async (path) => {
      const archivePath = `${path}/malformed.sdpub`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(Buffer.from("not json", "utf8"), "manifest.json");
      zipFile.addBuffer(Buffer.from("sqlite", "utf8"), "database.db");
      await writeZipFile(zipFile, archivePath);

      await expect(
        extractSdpubArchive(archivePath, `${path}/extract`),
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
