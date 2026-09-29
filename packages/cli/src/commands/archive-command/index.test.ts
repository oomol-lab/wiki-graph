import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findWikiGraphLibraryObjects,
  listWikiGraphLibraryObjects,
} from "wiki-graph-core";
import type * as WikiGraphCore from "wiki-graph-core";
import { setWikiGraphStateDirectoryPathForTesting } from "../../../../../test/helpers/wiki-graph-storage.js";
import { parseCLIArguments } from "../../args/index.js";
import { writeFindHits } from "../archive-output/index.js";
import { runArchiveCommand } from "./index.js";
import type * as ArchiveRun from "./run/index.js";

vi.mock("wiki-graph-core", async (importOriginal) => {
  const actual = await importOriginal<typeof WikiGraphCore>();
  return {
    ...actual,
    findArchiveObjects: vi.fn(),
    findWikiGraphLibraryObjects: vi.fn(),
    formatWikiGraphLibraryUri: vi.fn((publicId?: string) =>
      publicId === undefined ? "wikg://lib" : `wikg://lib/${publicId}`,
    ),
    listArchiveCollection: vi.fn(),
    listArchiveEvidence: vi.fn(),
    listRelatedArchiveObjects: vi.fn(),
    listRelatedWikiGraphLibraryObjects: vi.fn(),
    listWikiGraphLibraryEvidence: vi.fn(),
    listWikiGraphLibraryObjects: vi.fn(),
    packArchiveContext: vi.fn(),
    packWikiGraphLibraryContext: vi.fn(),
    parseLocatedWikiGraphUri: vi.fn((uri: string) => ({
      archivePath: uri,
      ...parseMockObjectUri(uri),
    })),
    parseWikiGraphLibraryUri: vi.fn((uri: string) => parseMockLibraryUri(uri)),
    readArchivePage: vi.fn(),
    readWikiGraphLibraryPage: vi.fn(),
    resolveWikiGraphLibrary: vi.fn().mockResolvedValue({ id: 42 }),
  };
});

vi.mock("../archive-output/index.js", () => ({
  writeAllEvidence: vi.fn(),
  writeAllFindHits: vi.fn(),
  writeAllRelatedItems: vi.fn(),
  writeEvidence: vi.fn(),
  writeFindHits: vi.fn(),
  writeFindHitsWithoutContinuation: vi.fn(),
  writeList: vi.fn(),
  writePack: vi.fn(),
  writePage: vi.fn(),
}));

vi.mock("../../runtime/config.js", () => ({
  loadCLIConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("../convert.js", () => ({ runConvertCommand: vi.fn() }));
vi.mock("./create.js", () => ({ createArchive: vi.fn() }));
vi.mock("./inspect.js", () => ({ writeArchiveInspectReport: vi.fn() }));
vi.mock("./run/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ArchiveRun>();
  return {
    ...actual,
    readArchiveDocument: vi.fn(),
    resolveArchiveCommandRuntimeArguments: vi.fn((args) =>
      Promise.resolve(args),
    ),
    runNextArchivePage: vi.fn(),
  };
});
vi.mock("./run/scope.js", () => ({ resolveArchiveChapterScope: vi.fn() }));

let testStateDir: string | undefined;

beforeEach(async () => {
  testStateDir = await mkdtemp(join(tmpdir(), "wikigraph-archive-command-"));
  setWikiGraphStateDirectoryPathForTesting(testStateDir);
  vi.clearAllMocks();
  vi.mocked(findWikiGraphLibraryObjects).mockResolvedValue({
    chapters: null,
    items: [],
    lens: "typed",
    lensHint: null,
    limit: 20,
    match: "any",
    nextCursor: null,
    order: "doc-asc",
    query: "memory",
    terms: ["memory"],
    types: ["triple"],
  });
  vi.mocked(listWikiGraphLibraryObjects).mockResolvedValue({
    chapters: null,
    ids: null,
    items: [],
    limit: 20,
    nextCursor: null,
    order: "doc-asc",
    types: ["triple"],
  });
});

afterEach(async () => {
  setWikiGraphStateDirectoryPathForTesting(undefined);
  if (testStateDir !== undefined) {
    await rm(testStateDir, { force: true, recursive: true });
    testStateDir = undefined;
  }
});

describe("runArchiveCommand library nested scopes", () => {
  it("searches library-wide triple pattern scopes through the library index", async () => {
    const parsed = parseCLIArguments([
      "wikg://lib/triple/Q1/P31",
      "--query",
      "memory",
      "--json",
    ]);
    if (parsed.kind !== "archive") {
      throw new Error(`Expected archive arguments, got ${parsed.kind}.`);
    }

    await runArchiveCommand(parsed.args);

    expect(findWikiGraphLibraryObjects).toHaveBeenCalledWith(
      {
        isDefault: true,
        kind: "scope",
        objectUri: "wikg://triple/Q1/P31",
      },
      "memory",
      expect.objectContaining({
        archiveKey: "wikg://lib/triple/Q1/P31",
        triplePattern: { predicate: "P31", subjectQid: "Q1" },
        types: ["triple"],
      }),
    );
    expect(writeFindHits).toHaveBeenCalled();
  });

  it("lists chapter-qualified triple pattern scopes through the library index", async () => {
    const parsed = parseCLIArguments([
      "wikg://lib/chapter/part/triple/Q1/P31",
      "--json",
    ]);
    if (parsed.kind !== "archive") {
      throw new Error(`Expected archive arguments, got ${parsed.kind}.`);
    }

    await runArchiveCommand(parsed.args);

    expect(listWikiGraphLibraryObjects).toHaveBeenCalledWith(
      {
        isDefault: true,
        kind: "scope",
        objectUri: "wikg://chapter/part/triple/Q1/P31",
      },
      expect.objectContaining({
        triplePattern: { predicate: "P31", subjectQid: "Q1" },
        types: ["triple"],
      }),
    );
    expect(writeFindHits).toHaveBeenCalled();
  });
});

function parseMockLibraryUri(uri: string):
  | {
      readonly isDefault: boolean;
      readonly kind: "scope";
      readonly objectUri?: string;
      readonly publicId?: string;
    }
  | undefined {
  if (!uri.startsWith("wikg://lib")) {
    return undefined;
  }
  const rest = uri.slice("wikg://lib".length).replace(/^\/+|\/+$/gu, "");
  if (rest === "") {
    return { isDefault: true, kind: "scope" };
  }
  const parts = rest.split("/");
  if (
    [
      "chapter",
      "chunk",
      "entity",
      "index",
      "source",
      "summary",
      "triple",
    ].includes(parts[0]!)
  ) {
    return {
      isDefault: true,
      kind: "scope",
      objectUri: `wikg://${parts.join("/")}`,
    };
  }
  const publicId = parts[0];
  if (publicId === undefined) {
    throw new Error(`Invalid mock library URI: ${uri}`);
  }
  return {
    isDefault: false,
    kind: "scope",
    ...(parts.length === 1
      ? {}
      : { objectUri: `wikg://${parts.slice(1).join("/")}` }),
    publicId,
  };
}

function parseMockObjectUri(uri: string): { readonly objectUri?: string } {
  const libraryTarget = parseMockLibraryUri(uri);
  if (libraryTarget?.objectUri !== undefined) {
    return { objectUri: libraryTarget.objectUri };
  }
  return {};
}
