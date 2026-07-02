import { createWriteStream } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { finished } from "stream/promises";

import { ZipFile } from "yazl";
import { describe, expect, it } from "vitest";

import { Database, DirectoryDocument } from "../../src/document/index.js";
import { extractWikgArchive } from "../../src/facade/archive.js";
import { migrateLegacySdpubToWikg } from "../../src/legacy-sdpub/upgrade.js";
import { withTempDir } from "../helpers/temp.js";

describe("legacy-sdpub/upgrade", () => {
  it("migrates a released sdpub archive into wikg", async () => {
    await withTempDir("spinedigest-legacy-sdpub-", async (path) => {
      const documentPath = `${path}/legacy-document`;
      const legacyArchivePath = `${path}/book.sdpub`;
      const migratedArchivePath = `${path}/book.wikg`;
      const extractedPath = `${path}/extracted`;

      await seedLegacyDocument(documentPath);
      await writeLegacyArchive(documentPath, legacyArchivePath, {
        manifest: false,
      });

      await expect(
        migrateLegacySdpubToWikg(legacyArchivePath),
      ).resolves.toStrictEqual({
        inputPath: legacyArchivePath,
        outputPath: migratedArchivePath,
      });
      await extractWikgArchive(migratedArchivePath, extractedPath);

      const document = await DirectoryDocument.open(extractedPath);

      try {
        await expect(document.readSummary(1)).resolves.toBe(
          "Summary sentence one.\nSummary sentence two.",
        );
        await expect(
          countSearchIndexRecords(document),
        ).resolves.toBeGreaterThan(0);
        await document.openSession(async (openedDocument) => {
          await expect(
            openedDocument.readingEdges.listAll(),
          ).resolves.toHaveLength(1);
        });
      } finally {
        await document.release();
      }
      await expect(
        readFile(`${extractedPath}/summaries/serial-1.txt`, "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(`${extractedPath}/summaries/serial-1/fragment_0.json`, "utf8"),
      ).resolves.toContain("Summary sentence one.");
    });
  });

  it("accepts released sdpub archives with a manifest", async () => {
    await withTempDir("spinedigest-legacy-sdpub-", async (path) => {
      const documentPath = `${path}/legacy-document`;
      const legacyArchivePath = `${path}/manifest.sdpub`;
      const outputPath = `${path}/custom.wikg`;

      await seedLegacyDocument(documentPath);
      await writeLegacyArchive(documentPath, legacyArchivePath, {
        manifest: true,
      });

      await expect(
        migrateLegacySdpubToWikg(legacyArchivePath, outputPath),
      ).resolves.toStrictEqual({
        inputPath: legacyArchivePath,
        outputPath,
      });
      await expect(readFile(outputPath)).resolves.toBeInstanceOf(Uint8Array);
    });
  });

  it("rejects unsupported legacy inputs", async () => {
    await withTempDir("spinedigest-legacy-sdpub-", async (path) => {
      const archivePath = `${path}/broken.sdpub`;
      const zipFile = new ZipFile();

      zipFile.addBuffer(Buffer.from("{}", "utf8"), "toc.json");
      await writeZipFile(zipFile, archivePath);

      await expect(migrateLegacySdpubToWikg(archivePath)).rejects.toThrow(
        "Unsupported legacy sdpub archive.",
      );
    });
  });

  it("rejects migration onto the input path", async () => {
    await expect(
      migrateLegacySdpubToWikg("book.sdpub", "book.sdpub"),
    ).rejects.toThrow("output path must differ from input path");
  });
});

async function seedLegacyDocument(documentPath: string): Promise<void> {
  await mkdir(`${documentPath}/fragments/serial-1`, { recursive: true });
  await mkdir(`${documentPath}/summaries`, { recursive: true });
  await mkdir(`${documentPath}/cover`, { recursive: true });
  await writeTextFile(
    `${documentPath}/book-meta.json`,
    JSON.stringify({
      authors: ["Author"],
      description: null,
      identifier: null,
      language: "en",
      publishedAt: null,
      publisher: null,
      sourceFormat: "txt",
      title: "Legacy Book",
      version: 1,
    }),
  );
  await writeTextFile(
    `${documentPath}/toc.json`,
    JSON.stringify({
      items: [{ children: [], serialId: 1, title: "Chapter 1" }],
      version: 1,
    }),
  );
  await writeTextFile(
    `${documentPath}/fragments/serial-1/fragment_0.json`,
    JSON.stringify({
      sentences: [{ text: "Source sentence.", wordsCount: 2 }],
      summary: "",
    }),
  );
  await writeTextFile(
    `${documentPath}/summaries/serial-1.txt`,
    "Summary sentence one.\nSummary sentence two.",
  );

  const database = await Database.open(`${documentPath}/database.db`);

  try {
    await database.run("CREATE TABLE serials (id INTEGER PRIMARY KEY)");
    await database.run(`
      CREATE TABLE serial_states (
        serial_id INTEGER PRIMARY KEY,
        topology_ready INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (serial_id) REFERENCES serials(id)
      )
    `);
    await database.run(`
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY,
        generation INTEGER NOT NULL,
        serial_id INTEGER NOT NULL,
        fragment_id INTEGER NOT NULL,
        sentence_index INTEGER NOT NULL,
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        retention TEXT,
        importance TEXT,
        wordsCount INTEGER NOT NULL DEFAULT 0,
        weight REAL NOT NULL DEFAULT 0.0
      )
    `);
    await database.run(`
      CREATE TABLE knowledge_edges (
        from_id INTEGER NOT NULL,
        to_id INTEGER NOT NULL,
        strength TEXT,
        weight REAL NOT NULL DEFAULT 0.1,
        PRIMARY KEY (from_id, to_id),
        FOREIGN KEY (from_id) REFERENCES chunks(id),
        FOREIGN KEY (to_id) REFERENCES chunks(id)
      )
    `);
    await database.run("INSERT INTO serials (id) VALUES (1)");
    await database.run(
      "INSERT INTO serial_states (serial_id, topology_ready) VALUES (1, 1)",
    );
    await database.run(`
      INSERT INTO chunks (
        id, generation, serial_id, fragment_id, sentence_index, label,
        content, wordsCount, weight
      ) VALUES
        (1, 0, 1, 0, 0, 'A', 'Alpha', 1, 1.0),
        (2, 0, 1, 0, 0, 'B', 'Beta', 1, 1.0)
    `);
    await database.run(
      "INSERT INTO knowledge_edges (from_id, to_id, strength, weight) VALUES (1, 2, 'strong', 0.8)",
    );
  } finally {
    await database.close();
  }
}

async function writeLegacyArchive(
  documentPath: string,
  archivePath: string,
  options: { readonly manifest: boolean },
): Promise<void> {
  const zipFile = new ZipFile();

  if (options.manifest) {
    zipFile.addBuffer(
      Buffer.from('{"formatVersion":1}', "utf8"),
      "manifest.json",
    );
  }
  zipFile.addFile(`${documentPath}/database.db`, "database.db");
  zipFile.addFile(`${documentPath}/book-meta.json`, "book-meta.json");
  zipFile.addFile(`${documentPath}/toc.json`, "toc.json");
  zipFile.addFile(
    `${documentPath}/fragments/serial-1/fragment_0.json`,
    "fragments/serial-1/fragment_0.json",
  );
  zipFile.addFile(
    `${documentPath}/summaries/serial-1.txt`,
    "summaries/serial-1.txt",
  );
  await writeZipFile(zipFile, archivePath);
}

async function countSearchIndexRecords(
  document: DirectoryDocument,
): Promise<number> {
  return await document.readDatabase(async (database) => {
    const row = await database.queryOne(
      `
        SELECT
          (SELECT COUNT(*) FROM text_sentence_records) +
          (SELECT COUNT(*) FROM search_object_properties_records) AS count
      `,
      undefined,
      (value) => Number(value.count),
    );

    return row ?? 0;
  });
}

async function writeZipFile(zipFile: ZipFile, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const output = createWriteStream(path);
  const outputDone = finished(output);
  const zipDone = finished(zipFile.outputStream);

  zipFile.outputStream.pipe(output);
  zipFile.end();
  await Promise.all([outputDone, zipDone]);
}

async function writeTextFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}
