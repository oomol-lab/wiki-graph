import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

import {
  addWikiGraphLibraryArchive,
  createWikiGraphLibrary,
  ensureDefaultWikiGraphLibrary,
  parseWikiGraphLibraryUri,
} from "../../../core/src/index.js";
import { withWikiGraphStateDirectoryPathForTesting } from "../../../../test/helpers/wiki-graph-storage.js";
import { runLibraryCommand } from "./library.js";
import { createEmptyArchive } from "./test-helpers.js";
import {
  getNodeResourcePath,
  NodeDirectory,
  NodeFile,
} from "../runtime/node-platform.js";

describe("library command", () => {
  it("scan prunes deleted members while registry listing remains library-only", async () => {
    await withLibraryCommandTestState(async (tempDir) => {
      const libraryFolder = join(tempDir, "library");
      const library = await createWikiGraphLibrary({
        folder: new NodeDirectory(libraryFolder),
      });
      const target = parseWikiGraphLibraryUri(`${library.uri}/arc`);
      expect(target).toBeDefined();
      await createEmptyArchive({
        path: join(libraryFolder, "book.wikg"),
        tempDir,
      });

      const firstScanOutput = await captureStdout(async () => {
        await runLibraryCommand({
          action: "scan",
          json: true,
          target: target!,
        });
      });
      const firstScan = JSON.parse(firstScanOutput) as {
        readonly items: Array<{
          readonly id: string;
          readonly relativePath: string;
        }>;
      };
      expect(firstScan.items).toHaveLength(1);
      const archiveId = firstScan.items[0]?.id;

      await rm(join(libraryFolder, "book.wikg"));
      const secondScanOutput = await captureStdout(async () => {
        await runLibraryCommand({
          action: "scan",
          json: true,
          target: target!,
        });
      });
      expect(JSON.parse(secondScanOutput)).toStrictEqual({ items: [] });

      const libraryListOutput = await captureStdout(async () => {
        await runLibraryCommand({
          action: "list",
          json: true,
          target: { isDefault: true, kind: "registry" },
        });
      });
      const libraryList = JSON.parse(libraryListOutput) as {
        readonly items: Array<{ readonly id: string; readonly uri: string }>;
      };
      expect(libraryList.items).toContainEqual(
        expect.objectContaining({ id: library.publicId, uri: library.uri }),
      );
      expect(libraryListOutput).not.toContain(archiveId);
    });
  });

  it("filters archive tree by file parent without changing the display root", async () => {
    await withLibraryCommandTestState(async (tempDir) => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const source = join(tempDir, "source.wikg");
      await createEmptyArchive({ path: source, tempDir });
      const archive = await addWikiGraphLibraryArchive({
        inputFile: new NodeFile(source),
        target: target!,
        to: "nested/book.wikg",
      });

      await addWikiGraphLibraryArchive({
        inputFile: new NodeFile(source),
        target: target!,
        to: "other.wikg",
      });

      const output = await captureStdout(async () => {
        await runLibraryCommand({
          action: "archive-tree",
          json: true,
          parent: "nested/book.wikg",
          target: { isDefault: true, kind: "archive-tree" },
        });
      });

      expect(JSON.parse(output)).toStrictEqual({
        items: [
          {
            children: [
              {
                children: [],
                name: "book.wikg",
                path: "nested/book.wikg",
                uri: archive.uri,
              },
            ],
            name: "nested",
            path: "nested",
          },
        ],
      });

      const textOutput = await captureStdout(async () => {
        await runLibraryCommand({
          action: "archive-tree",
          parent: "nested/book.wikg",
          target: { isDefault: true, kind: "archive-tree" },
        });
      });

      expect(textOutput).toBe(`└─ nested\n   └─ book.wikg (${archive.uri})\n`);
    });
  });

  it("replaces a managed archive through the public command", async () => {
    await withLibraryCommandTestState(async (tempDir) => {
      const target = parseWikiGraphLibraryUri("wikg://lib");
      expect(target).toBeDefined();
      const source = join(tempDir, "source.wikg");
      const replacement = join(tempDir, "replacement.wikg");
      await createEmptyArchive({ path: source, tempDir });
      await createEmptyArchive({ path: replacement, tempDir });
      const library = await ensureDefaultWikiGraphLibrary();
      const archive = await addWikiGraphLibraryArchive({
        inputFile: new NodeFile(source),
        target: target!,
        to: "book.wikg",
      });
      const archiveTarget = parseWikiGraphLibraryUri(archive.uri);
      expect(archiveTarget?.kind).toBe("archive");
      const managedPath = join(
        getNodeResourcePath(library.folder),
        "book.wikg",
      );
      const before = await readFile(managedPath);

      const output = await captureStdout(async () => {
        await runLibraryCommand({
          action: "replace",
          inputPath: replacement,
          json: true,
          target: archiveTarget!,
        });
      });

      expect(JSON.parse(output)).toMatchObject({
        id: archive.publicId,
        relativePath: archive.relativePath,
        uri: archive.uri,
      });
      expect(await readFile(managedPath)).not.toEqual(before);
    });
  });
});

async function withLibraryCommandTestState(
  operation: (tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "wikigraph-cli-library-test-"));

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

async function captureStdout(operation: () => Promise<void>): Promise<string> {
  let output = "";
  const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    output += String(chunk);
    if (typeof encodingOrCallback === "function") {
      encodingOrCallback();
    } else {
      callback?.();
    }
    return true;
  }) as typeof process.stdout.write);
  try {
    await operation();
  } finally {
    stdoutWrite.mockRestore();
  }
  return output;
}
