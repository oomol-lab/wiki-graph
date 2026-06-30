import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BookMeta } from "../../src/source/index.js";

const archiveMaintenanceMockState = vi.hoisted(() => ({
  binaryWrites: [] as Uint8Array[],
  cover: {
    data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    mediaType: "image/png",
    path: "images/cover.png",
  } as
    | {
        readonly data: Uint8Array;
        readonly mediaType: string;
        readonly path: string;
      }
    | undefined,
  writeCalls: [] as string[],
  meta: {
    authors: ["Ari Lantern", "Bea North"],
    description: "Fixture description",
    identifier: "urn:test:archive-cli",
    language: "en",
    publishedAt: "2026-01-01",
    publisher: "Open Sample Press",
    sourceFormat: "epub",
    title: "Fixture Book",
    version: 1,
  } as BookMeta,
  openCalls: [] as string[],
  replacedMeta: [] as unknown[],
  textWrites: [] as string[],
}));

vi.mock("../../src/index.js", () => ({
  SpineDigestApp: class {
    public async openSession(
      path: string,
      operation: (digest: MockDigest) => Promise<unknown>,
    ): Promise<unknown> {
      archiveMaintenanceMockState.openCalls.push(path);
      return await operation(createMockDigest());
    }
  },
}));

vi.mock("../../src/facade/spine-digest-file.js", () => ({
  SpineDigestFile: class {
    readonly #path: string;

    public constructor(path: string) {
      this.#path = path;
    }

    public async write(
      operation: (document: MockEditableDocument) => Promise<unknown>,
    ): Promise<unknown> {
      archiveMaintenanceMockState.writeCalls.push(this.#path);
      return await operation({
        readBookMeta: () => Promise.resolve(archiveMaintenanceMockState.meta),
        replaceBookMeta: (meta: unknown) => {
          archiveMaintenanceMockState.replacedMeta.push(meta);
          archiveMaintenanceMockState.meta =
            meta as typeof archiveMaintenanceMockState.meta;
          return Promise.resolve();
        },
      });
    }
  },
}));

vi.mock("../../src/cli/io.js", () => ({
  writeBinaryToStdout: vi.fn((data: Uint8Array) => {
    archiveMaintenanceMockState.binaryWrites.push(data);
    return Promise.resolve();
  }),
  writeTextToStdout: vi.fn((text: string) => {
    archiveMaintenanceMockState.textWrites.push(text);
    return Promise.resolve();
  }),
}));

import {
  runArchiveCoverCommand,
  runArchiveMetaCommand,
} from "../../src/cli/archive-maintenance.js";

describe("cli/archive maintenance", () => {
  const originalStdoutIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    archiveMaintenanceMockState.binaryWrites.length = 0;
    archiveMaintenanceMockState.cover = {
      data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      mediaType: "image/png",
      path: "images/cover.png",
    };
    archiveMaintenanceMockState.writeCalls.length = 0;
    archiveMaintenanceMockState.meta = {
      authors: ["Ari Lantern", "Bea North"],
      description: "Fixture description",
      identifier: "urn:test:archive-cli",
      language: "en",
      publishedAt: "2026-01-01",
      publisher: "Open Sample Press",
      sourceFormat: "epub",
      title: "Fixture Book",
      version: 1,
    };
    archiveMaintenanceMockState.openCalls.length = 0;
    archiveMaintenanceMockState.replacedMeta.length = 0;
    archiveMaintenanceMockState.textWrites.length = 0;
    setStdoutTTY(false);
  });

  afterEach(() => {
    setStdoutTTY(originalStdoutIsTTY);
  });

  it("renders book metadata", async () => {
    await runArchiveMetaCommand({
      inputPath: "/tmp/book.wikg",
    });

    expect(archiveMaintenanceMockState.openCalls).toStrictEqual([
      "/tmp/book.wikg",
    ]);
    expect(archiveMaintenanceMockState.textWrites).toStrictEqual([
      [
        "Source Format: epub",
        "Title: Fixture Book",
        "Authors: Ari Lantern, Bea North",
        "Language: en",
        "Identifier: urn:test:archive-cli",
        "Publisher: Open Sample Press",
        "Published At: 2026-01-01",
        "Description: Fixture description",
        "",
      ].join("\n"),
    ]);
  });

  it("renders book metadata as JSON", async () => {
    await runArchiveMetaCommand({
      inputPath: "/tmp/book.wikg",
      json: true,
    });

    expect(
      JSON.parse(archiveMaintenanceMockState.textWrites[0]!),
    ).toStrictEqual({
      authors: ["Ari Lantern", "Bea North"],
      description: "Fixture description",
      identifier: "urn:test:archive-cli",
      language: "en",
      publishedAt: "2026-01-01",
      publisher: "Open Sample Press",
      sourceFormat: "epub",
      title: "Fixture Book",
    });
  });

  it("updates book metadata in place and prints the result", async () => {
    await runArchiveMetaCommand({
      inputPath: "/tmp/book.wikg",
      metaPatch: {
        authors: ["Cy Lake"],
        clearDescription: true,
        title: "Updated Fixture",
      },
    });

    expect(archiveMaintenanceMockState.writeCalls).toStrictEqual([
      "/tmp/book.wikg",
    ]);
    expect(archiveMaintenanceMockState.replacedMeta).toStrictEqual([
      {
        authors: ["Cy Lake"],
        description: null,
        identifier: "urn:test:archive-cli",
        language: "en",
        publishedAt: "2026-01-01",
        publisher: "Open Sample Press",
        sourceFormat: "epub",
        title: "Updated Fixture",
        version: 1,
      },
    ]);
    expect(archiveMaintenanceMockState.textWrites).toStrictEqual([
      [
        "Source Format: epub",
        "Title: Updated Fixture",
        "Authors: Cy Lake",
        "Language: en",
        "Identifier: urn:test:archive-cli",
        "Publisher: Open Sample Press",
        "Published At: 2026-01-01",
        "Description: [none]",
        "",
      ].join("\n"),
    ]);
  });

  it("writes raw cover bytes", async () => {
    await runArchiveCoverCommand({
      inputPath: "/tmp/book.wikg",
    });

    expect(archiveMaintenanceMockState.binaryWrites).toHaveLength(1);
    expect(
      Array.from(archiveMaintenanceMockState.binaryWrites[0]!),
    ).toStrictEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("rejects binary cover output to an interactive terminal", async () => {
    setStdoutTTY(true);

    await expect(
      runArchiveCoverCommand({
        inputPath: "/tmp/book.wikg",
      }),
    ).rejects.toThrow(
      "Refusing to write binary cover data to an interactive terminal. Redirect stdout or pipe it.",
    );

    expect(archiveMaintenanceMockState.binaryWrites).toHaveLength(0);
  });

  it("fails when the cover is missing", async () => {
    archiveMaintenanceMockState.cover = undefined;

    await expect(
      runArchiveCoverCommand({
        inputPath: "/tmp/book.wikg",
      }),
    ).rejects.toThrow("Document cover is missing.");
  });
});

interface MockDigest {
  readCover(): Promise<typeof archiveMaintenanceMockState.cover>;
  readMeta(): Promise<typeof archiveMaintenanceMockState.meta>;
}

interface MockEditableDocument {
  readBookMeta(): Promise<typeof archiveMaintenanceMockState.meta>;
  replaceBookMeta(meta: unknown): Promise<void>;
}

function createMockDigest(): MockDigest {
  return {
    readCover: () => Promise.resolve(archiveMaintenanceMockState.cover),
    readMeta: () => Promise.resolve(archiveMaintenanceMockState.meta),
  };
}

function setStdoutTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
}
