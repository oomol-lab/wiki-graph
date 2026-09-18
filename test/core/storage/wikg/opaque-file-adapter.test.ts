import { mkdir, readFile, writeFile } from "fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { WikiGraphArchive } from "../../../../packages/core/src/api/wiki-graph-archive.js";
import { WikiGraph } from "../../../../packages/core/src/api/app.js";
import { DirectoryDocument } from "../../../../packages/core/src/document/index.js";
import {
  installWikiGraphPlatform,
  type Directory,
  type File,
  type HostDatabaseConnection,
  type WikiGraphPlatform,
  withWikiGraphStorage,
} from "../../../../packages/core/src/runtime/platform/index.js";
import { WikiGraphArchiveFile } from "../../../../packages/core/src/storage/wikg/wiki-graph-archive-file.js";
import {
  installNodeWikiGraphPlatform,
  NodeDirectory,
  NodeFile,
  nodeWikiGraphPlatform,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../../../helpers/temp.js";

afterEach(() => {
  installNodeWikiGraphPlatform();
});

describe("opaque archive File adapter", () => {
  it("keeps a NodeDirectory archive File independent from the current directory", async () => {
    await withTempDir("wikigraph-node-directory-file-", async (path) => {
      const targetDirectoryPath = `${path}/target`;
      const archivePath = await createSeedArchive(targetDirectoryPath);
      const decoyDirectoryPath = `${path}/wrong-cwd`;
      const decoyPath = `${decoyDirectoryPath}/book.wikg`;
      const storage = {
        documentStore: new NodeDirectory(`${path}/storage/documents`),
        library: new NodeDirectory(`${path}/storage/library`),
      };
      await mkdir(`${path}/storage/documents`, { recursive: true });
      await mkdir(`${path}/storage/library`, { recursive: true });
      await mkdir(decoyDirectoryPath, { recursive: true });
      await writeFile(decoyPath, "This is the same-name cwd decoy, not a ZIP.");
      const decoyBefore = await readFile(decoyPath);

      const archive = await new NodeDirectory(targetDirectoryPath).getFile(
        "book.wikg",
      );
      expect(archive).toBeDefined();

      installWikiGraphPlatform(nodeWikiGraphPlatform);
      const originalWorkingDirectory = process.cwd();
      process.chdir(decoyDirectoryPath);
      try {
        await expect(
          new WikiGraph({ storage }).openSession(
            archive!,
            async (opened) => (await opened.readMeta())?.title,
          ),
        ).resolves.toBe("Before");

        await withWikiGraphStorage(storage, async () => {
          await new WikiGraphArchiveFile(archive!).write(async (document) => {
            await document.replaceBookMeta(createMeta("After directory File"));
          });
          await expect(readTitle(archive!)).resolves.toBe(
            "After directory File",
          );
        });

        expect(await readFile(decoyPath)).toEqual(decoyBefore);
        expect(await storage.documentStore.list()).toEqual([]);
      } finally {
        process.chdir(originalWorkingDirectory);
      }

      installNodeWikiGraphPlatform();
      await withWikiGraphStorage(storage, async () => {
        await expect(readTitle(new NodeFile(archivePath))).resolves.toBe(
          "After directory File",
        );
      });
      expect(await readFile(decoyPath)).toEqual(decoyBefore);
    });
  });

  it("reads and writes without turning File.name into an OS path", async () => {
    await withTempDir("wikigraph-opaque-file-", async (path) => {
      const archivePath = await createSeedArchive(path);
      await mkdir(`${path}/storage/library`, { recursive: true });
      await mkdir(`${path}/storage/documents`, { recursive: true });

      const archive = wrapFile(new NodeFile(archivePath));
      const storage = {
        documentStore: wrapDirectory(
          new NodeDirectory(`${path}/storage/documents`),
        ),
        library: wrapDirectory(new NodeDirectory(`${path}/storage/library`)),
      };
      installWikiGraphPlatform(opaqueNodePlatform);

      const directDocumentRoot =
        await storage.documentStore.createDirectory("direct-document");
      const directDocument = await DirectoryDocument.open(directDocumentRoot);
      try {
        await directDocument.createSerial();
        await directDocument.writeBookMeta(createMeta("Opaque directory"));
        await directDocument.writeSummary(1, "Directory-backed text");
        await expect(directDocument.readBookMeta()).resolves.toMatchObject({
          title: "Opaque directory",
        });
        await expect(directDocument.readSummary(1)).resolves.toBe(
          "Directory-backed text",
        );
      } finally {
        await directDocument.release();
        await storage.documentStore.remove("direct-document", {
          recursive: true,
        });
      }

      expect("path" in archive).toBe(false);
      await expect(
        new WikiGraph({ storage }).openSession(archive, async (opened) => ({
          formatVersion: await opened.readArchiveFormatVersion(),
          title: (await opened.readMeta())?.title,
        })),
      ).resolves.toEqual({ formatVersion: 1, title: "Before" });
      await withWikiGraphStorage(storage, async () => {
        await new WikiGraphArchiveFile(archive).write(async (document) => {
          await document.replaceBookMeta(createMeta("After"));
          await document.writeSummary(1, "Written through an opaque File.");
        });
        await expect(readTitle(archive)).resolves.toBe("After");
        await expect(
          new WikiGraphArchiveFile(archive).read(async (opened) =>
            opened.readSerialSummary(1),
          ),
        ).resolves.toBe("Written through an opaque File.");

        let activeWrites = 0;
        let maximumActiveWrites = 0;
        const writeTitle = async (file: File, title: string) => {
          await new WikiGraphArchiveFile(file).write(async (document) => {
            activeWrites += 1;
            maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
            await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
            await document.replaceBookMeta(createMeta(title));
            activeWrites -= 1;
          });
        };
        await Promise.all([
          writeTitle(archive, "First serialized write"),
          writeTitle(wrapFile(new NodeFile(archivePath)), "Final title"),
        ]);
        expect(maximumActiveWrites).toBe(1);
        await expect(readTitle(archive)).resolves.toBe("Final title");
      });

      expect(await storage.documentStore.list()).toEqual([]);

      installNodeWikiGraphPlatform();
      await withWikiGraphStorage(
        {
          documentStore: new NodeDirectory(`${path}/storage/documents`),
          library: new NodeDirectory(`${path}/storage/library`),
        },
        async () => {
          await expect(readTitle(new NodeFile(archivePath))).resolves.toBe(
            "Final title",
          );
        },
      );
    });
  });

  it("keeps the archive intact when the host ZIP commit fails", async () => {
    await withTempDir("wikigraph-opaque-rollback-", async (path) => {
      const archivePath = await createSeedArchive(path);
      await mkdir(`${path}/storage/library`, { recursive: true });
      await mkdir(`${path}/storage/documents`, { recursive: true });
      const archive = wrapFile(new NodeFile(archivePath));
      const storage = {
        documentStore: wrapDirectory(
          new NodeDirectory(`${path}/storage/documents`),
        ),
        library: wrapDirectory(new NodeDirectory(`${path}/storage/library`)),
      };
      installWikiGraphPlatform({
        ...opaqueNodePlatform,
        zip: {
          ...opaqueNodePlatform.zip,
          write: () =>
            Promise.reject(new Error("simulated host commit failure")),
        },
      });

      await expect(
        withWikiGraphStorage(storage, async () => {
          await new WikiGraphArchiveFile(archive).write(async (document) => {
            await document.replaceBookMeta(createMeta("Must not commit"));
          });
        }),
      ).rejects.toThrow("simulated host commit failure");
      expect(await storage.documentStore.list()).toEqual([]);

      installNodeWikiGraphPlatform();
      await withWikiGraphStorage(
        {
          documentStore: new NodeDirectory(`${path}/storage/documents`),
          library: new NodeDirectory(`${path}/storage/library`),
        },
        async () => {
          await expect(readTitle(new NodeFile(archivePath))).resolves.toBe(
            "Before",
          );
        },
      );
    });
  });
});

const backingFiles = new WeakMap<File, NodeFile>();
function wrapFile(backing: NodeFile): File {
  const file: File = {
    getSize: async () => await backing.getSize(),
    identity: backing.identity,
    name: backing.name,
    openReader: async () => await backing.openReader(),
    openWriter: async () => await backing.openWriter(),
    read: async (options) => await backing.read(options),
  };
  backingFiles.set(file, backing);
  return file;
}

function wrapDirectory(backing: NodeDirectory): Directory {
  const directory: Directory = {
    createDirectory: async (name) =>
      wrapDirectory((await backing.createDirectory(name)) as NodeDirectory),
    createFile: async (name) =>
      wrapFile((await backing.createFile(name)) as NodeFile),
    getDirectory: async (name) => {
      const value = await backing.getDirectory(name);
      return value === undefined
        ? undefined
        : wrapDirectory(value as NodeDirectory);
    },
    getFile: async (name) => {
      const value = await backing.getFile(name);
      return value === undefined ? undefined : wrapFile(value as NodeFile);
    },
    identity: backing.identity,
    list: async () =>
      (await backing.list()).map((entry) =>
        entry instanceof NodeDirectory
          ? wrapDirectory(entry)
          : wrapFile(entry as NodeFile),
      ),
    name: backing.name,
    remove: async (name, options) => await backing.remove(name, options),
  };
  return directory;
}

const opaqueNodePlatform: WikiGraphPlatform = {
  asyncContext: nodeWikiGraphPlatform.asyncContext,
  database: {
    open: async (file, options): Promise<HostDatabaseConnection> =>
      await nodeWikiGraphPlatform.database.open(unwrapFile(file), options),
  },
  lifecycle: nodeWikiGraphPlatform.lifecycle,
  resources: {
    getDirectory: async (identity) => {
      const directory =
        await nodeWikiGraphPlatform.resources.getDirectory(identity);
      return directory === undefined
        ? undefined
        : wrapDirectory(directory as NodeDirectory);
    },
    getFile: async (identity) => {
      const file = await nodeWikiGraphPlatform.resources.getFile(identity);
      return file === undefined ? undefined : wrapFile(file as NodeFile);
    },
  },
  templates: nodeWikiGraphPlatform.templates,
  zip: {
    open: async (file) =>
      await nodeWikiGraphPlatform.zip.open(unwrapFile(file)),
    write: async (file, entries) =>
      await nodeWikiGraphPlatform.zip.write(unwrapFile(file), entries),
  },
};

function unwrapFile(file: File): NodeFile {
  const backing = backingFiles.get(file);
  if (backing === undefined) throw new TypeError("Unknown opaque File");
  return backing;
}

async function createSeedArchive(root: string): Promise<string> {
  const document = await DirectoryDocument.open(`${root}/document`);
  try {
    await document.openSession(async (opened) => {
      await opened.createSerial();
      await opened.writeBookMeta(createMeta("Before"));
      await opened.writeSummary(1, "Before summary");
      await opened.writeToc({
        items: [
          {
            children: [],
            key: "opaque-file-1",
            serialId: 1,
            title: "Opaque file chapter",
          },
        ],
        version: 1,
      });
    });
    const archivePath = `${root}/book.wikg`;
    await new WikiGraphArchive(
      document,
      new NodeDirectory(`${root}/document`),
    ).saveAs(new NodeFile(archivePath));
    return archivePath;
  } finally {
    await document.release();
  }
}

function createMeta(title: string) {
  return {
    authors: [],
    description: null,
    identifier: null,
    language: null,
    publishedAt: null,
    publisher: null,
    sourceFormat: "txt" as const,
    title,
    version: 1 as const,
  };
}

async function readTitle(file: File): Promise<string | undefined> {
  return await new WikiGraphArchiveFile(file).read(
    async (archive) => (await archive.readMeta())?.title ?? undefined,
  );
}
