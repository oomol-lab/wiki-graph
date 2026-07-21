import { mkdtemp, rm, stat, writeFile } from "fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { archiveMockState, resetArchiveMockState } from "./mock.js";
import { runArchiveCommand } from "../../../packages/cli/src/commands/index.js";

beforeEach(resetArchiveMockState);

describe("cli/archive/create", () => {
  it("prints archive object output after creating an empty archive", async () => {
    const directoryPath = await mkdtemp(join(tmpdir(), "wikigraph-create-"));
    const archivePath = join(directoryPath, "new.wikg");

    try {
      await runArchiveCommand({
        action: "create",
        archivePath,
      });

      expect((await stat(archivePath)).size).toBeGreaterThan(0);
      expect(archiveMockState.textWrites[0]).toBe("<archive>\n");
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  });

  it("prints archive object JSON after importing EPUB", async () => {
    const directoryPath = await mkdtemp(join(tmpdir(), "wikigraph-create-"));
    const archivePath = join(directoryPath, "new.wikg");

    try {
      await runArchiveCommand({
        action: "create",
        archivePath,
        importPath: "/tmp/book.epub",
        json: true,
      });

      expect(archiveMockState.convertCalls).toStrictEqual([
        expect.objectContaining({
          inputPath: "/tmp/book.epub",
          outputFormat: "wikg",
          outputPath: archivePath,
          targetStage: "sourced",
        }),
      ]);
      expect(JSON.parse(archiveMockState.textWrites[0] ?? "")).toStrictEqual({
        uri: `wikg://${archivePath}`,
      });
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  });

  it("rejects creating over an existing archive without replace", async () => {
    const directoryPath = await mkdtemp(join(tmpdir(), "wikigraph-create-"));
    const archivePath = join(directoryPath, "existing.wikg");

    try {
      await writeFile(archivePath, "existing");

      await expect(
        runArchiveCommand({
          action: "create",
          archivePath,
          importPath: "/tmp/book.epub",
        }),
      ).rejects.toThrow("Archive already exists:");
      expect(archiveMockState.convertCalls).toStrictEqual([]);
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  });

  it("creates replacement archives through a temporary output path", async () => {
    const directoryPath = await mkdtemp(join(tmpdir(), "wikigraph-create-"));
    const archivePath = join(directoryPath, "existing.wikg");

    try {
      await writeFile(archivePath, "existing");

      await runArchiveCommand({
        action: "create",
        archivePath,
        importPath: "/tmp/book.epub",
        replace: true,
      });

      const [convertCall] = archiveMockState.convertCalls as Array<{
        readonly outputPath: string;
      }>;

      if (convertCall === undefined) {
        throw new Error("Expected create to call convert.");
      }
      expect(convertCall.outputPath).not.toBe(archivePath);
      expect(convertCall.outputPath).toContain("existing.wikg");
      expect(archiveMockState.textWrites[0]).toBe("<archive>\n");
    } finally {
      await rm(directoryPath, { force: true, recursive: true });
    }
  });
});
