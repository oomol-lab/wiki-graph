import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const archives = new Map<number, Record<string, unknown>>();
  const objectArchiveIds = new Map<string, readonly number[]>();
  let listIndexResult: {
    readonly objectHits: readonly Record<string, unknown>[];
    readonly terms: readonly string[];
    readonly textHits: readonly Record<string, unknown>[];
  };
  const pages = new Map<string, Record<string, unknown>>();
  const evidence = new Map<string, readonly Record<string, unknown>[]>();
  const related = new Map<string, readonly Record<string, unknown>[]>();
  const packs = new Map<
    string,
    {
      readonly anchor: Record<string, unknown>;
      readonly related: readonly Record<string, unknown>[];
    }
  >();

  return {
    archives,
    evidence,
    objectArchiveIds,
    get listIndexResult() {
      return listIndexResult;
    },
    set listIndexResult(value: typeof listIndexResult) {
      listIndexResult = value;
    },
    packs,
    pages,
    related,
    reset() {
      archives.clear();
      listIndexResult = { objectHits: [], terms: [], textHits: [] };
      objectArchiveIds.clear();
      pages.clear();
      evidence.clear();
      related.clear();
      packs.clear();
    },
  };
});

vi.mock("../../../packages/core/src/storage/wikg/index.js", () => ({
  WikiGraphArchiveFile: class {
    public readonly path: string;

    public constructor(path: string) {
      this.path = path;
    }

    public async readDocument<T>(
      operation: (document: { readonly path: string }) => T,
    ) {
      return await operation({ path: this.path });
    }
  },
}));

vi.mock("../../../packages/core/src/library/registry.js", () => ({
  parseWikiGraphLibraryUri: vi.fn((uri: string) => ({
    isDefault: uri === "wikg://lib",
    kind: "scope",
  })),
  resolveWikiGraphLibrary: vi.fn(() =>
    Promise.resolve({ id: 1, uri: "wikg://lib" }),
  ),
  resolveWikiGraphLibraryById: vi.fn((id: number) =>
    Promise.resolve({
      id,
      isDefault: true,
      publicId: "default",
      uri: "wikg://lib",
    }),
  ),
}));

vi.mock("../../../packages/core/src/library/membership.js", () => ({
  getWikiGraphLibraryArchiveById: vi.fn((_library: unknown, id: number) => {
    const archive = mocks.archives.get(id);
    if (archive === undefined) {
      throw new Error(`Unknown archive ${id}`);
    }
    return Promise.resolve(archive);
  }),
  listWikiGraphLibraryArchives: vi.fn(() =>
    Promise.resolve([...mocks.archives.values()]),
  ),
}));

vi.mock("../../../packages/core/src/library/search-index.js", () => ({
  assertWikiGraphLibraryIndexReady: vi.fn(() =>
    Promise.resolve({ status: "current" }),
  ),
  listWikiGraphLibrarySearchIndex: vi.fn(() =>
    Promise.resolve(mocks.listIndexResult),
  ),
  listWikiGraphLibraryIndexArchiveIdsForObject: vi.fn(
    (_target, objectUri: string) =>
      Promise.resolve(mocks.objectArchiveIds.get(objectUri) ?? []),
  ),
  queryWikiGraphLibrarySearchIndex: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock(
  "../../../packages/core/src/retrieval/query/archive-view/index.js",
  () => ({
    listArchiveCollection: vi.fn(() => Promise.resolve({ items: [] })),
    listArchiveEvidence: vi.fn(
      (document: { readonly path: string }, objectUri: string) =>
        Promise.resolve({
          items: mocks.evidence.get(`${document.path}:${objectUri}`) ?? [],
          limit: Number.MAX_SAFE_INTEGER,
          nextCursor: null,
        }),
    ),
    listRelatedArchiveObjects: vi.fn(
      (document: { readonly path: string }, objectUri: string) =>
        Promise.resolve({
          items: mocks.related.get(`${document.path}:${objectUri}`) ?? [],
          limit: Number.MAX_SAFE_INTEGER,
          nextCursor: null,
        }),
    ),
    packArchiveContext: vi.fn(
      (
        document: { readonly path: string },
        objectUri: string,
        budget: number,
      ) =>
        Promise.resolve({
          ...(mocks.packs.get(`${document.path}:${objectUri}`) ?? {
            anchor: { id: objectUri, label: objectUri, type: "entity" },
            related: [],
          }),
          budget,
        }),
    ),
    readArchivePage: vi.fn(
      (document: { readonly path: string }, objectUri: string) => {
        const page = mocks.pages.get(`${document.path}:${objectUri}`);
        if (page === undefined) {
          throw new Error(`missing page ${document.path}:${objectUri}`);
        }
        return Promise.resolve(page);
      },
    ),
  }),
);

vi.mock(
  "../../../packages/core/src/retrieval/query/archive-view/search/hydration.js",
  () => ({
    hydrateSearchIndexHits: vi.fn(
      (
        _document: { readonly path: string },
        result: { readonly objectHits: readonly Record<string, unknown>[] },
      ) =>
        Promise.resolve(
          result.objectHits.map((hit) => ({
            chapter: Number(hit.ownerId),
            field: "title" as const,
            id: `wikg://chapter/${String(hit.ownerId)}/title`,
            position: { chapter: Number(hit.ownerId) },
            snippet: `Chapter ${String(hit.ownerId)}`,
            title: `Chapter ${String(hit.ownerId)}`,
            type: "chapter-title" as const,
          })),
        ),
    ),
  }),
);

const target = { isDefault: true, kind: "scope" as const };

function seedArchive(id: number, status = "present") {
  mocks.archives.set(id, {
    exists: true,
    id,
    path: `archive-${id}.wikg`,
    status,
    uri: `wikg://lib/archive-${id}`,
  });
}

describe("wiki graph library object query aggregation", () => {
  beforeEach(() => {
    mocks.reset();
    seedArchive(1);
    seedArchive(2);
  });

  it("returns all archive sources for a library get", async () => {
    const { readWikiGraphLibraryPage } =
      await import("../../../packages/core/src/library/query.js");

    mocks.objectArchiveIds.set("wikg://entity/Q1", [1, 2]);
    mocks.pages.set("archive-1.wikg:wikg://entity/Q1", {
      evidence: { nextCursor: null, shown: 1, sources: [], total: 1 },
      id: "wikg://entity/Q1",
      label: "Shared",
      labels: ["Shared"],
      mentionCount: 1,
      qid: "Q1",
      type: "entity",
    });
    mocks.pages.set("archive-2.wikg:wikg://entity/Q1", {
      evidence: { nextCursor: null, shown: 1, sources: [], total: 1 },
      id: "wikg://entity/Q1",
      label: "Shared",
      labels: ["Shared"],
      mentionCount: 1,
      qid: "Q1",
      type: "entity",
    });

    const page = await readWikiGraphLibraryPage(target, "wikg://entity/Q1");

    expect(page).toMatchObject({
      id: "wikg://entity/Q1",
      sources: [
        { archiveId: 1, libraryArchiveUri: "wikg://lib/archive-1" },
        { archiveId: 2, libraryArchiveUri: "wikg://lib/archive-2" },
      ],
      type: "entity",
    });
  });

  it("aggregates evidence with stable cursor pagination and source fields", async () => {
    const { listWikiGraphLibraryEvidence } =
      await import("../../../packages/core/src/library/query.js");

    mocks.objectArchiveIds.set("wikg://entity/Q1", [1, 2]);
    mocks.evidence.set("archive-1.wikg:wikg://entity/Q1", [
      createEvidence("a", 2),
      createEvidence("b", 4),
    ]);
    mocks.evidence.set("archive-2.wikg:wikg://entity/Q1", [
      createEvidence("c", 1),
    ]);

    const first = await listWikiGraphLibraryEvidence(
      target,
      "wikg://entity/Q1",
      {
        limit: 2,
      },
    );
    const second = await listWikiGraphLibraryEvidence(
      target,
      "wikg://entity/Q1",
      {
        ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
        limit: 2,
      },
    );

    expect(first.items.map((item) => [item.id, item.archiveId])).toStrictEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(first.nextCursor).toBe("2");
    expect(second.items.map((item) => [item.id, item.archiveId])).toStrictEqual(
      [["c", 2]],
    );
    expect(second.nextCursor).toBeNull();
  });

  it("aggregates triple evidence across archives", async () => {
    const { listWikiGraphLibraryEvidence } =
      await import("../../../packages/core/src/library/query.js");

    const tripleUri = "wikg://triple/Q1/mentions/Q2";
    mocks.objectArchiveIds.set(tripleUri, [1, 2]);
    mocks.evidence.set(`archive-1.wikg:${tripleUri}`, [
      createEvidence("t1", 1),
    ]);
    mocks.evidence.set(`archive-2.wikg:${tripleUri}`, [
      createEvidence("t2", 1),
    ]);

    const result = await listWikiGraphLibraryEvidence(target, tripleUri);

    expect(result.items.map((item) => item.archiveId)).toStrictEqual([1, 2]);
  });

  it("scans readable archives for non-indexed triple pages", async () => {
    const { readWikiGraphLibraryPage } =
      await import("../../../packages/core/src/library/query.js");

    const tripleUri = "wikg://triple/Q1/mentions/Q2";
    mocks.pages.set(`archive-1.wikg:${tripleUri}`, {
      evidence: { nextCursor: null, shown: 1, sources: [], total: 1 },
      id: tripleUri,
      label: "Q1 mentions Q2",
      objectQid: "Q2",
      predicate: "mentions",
      subjectQid: "Q1",
      type: "triple",
    });
    mocks.pages.set(`archive-2.wikg:${tripleUri}`, {
      evidence: { nextCursor: null, shown: 1, sources: [], total: 1 },
      id: tripleUri,
      label: "Q1 mentions Q2",
      objectQid: "Q2",
      predicate: "mentions",
      subjectQid: "Q1",
      type: "triple",
    });

    const page = await readWikiGraphLibraryPage(target, tripleUri);

    expect(page).toMatchObject({
      id: tripleUri,
      sources: [
        { archiveId: 1, libraryArchiveUri: "wikg://lib/archive-1" },
        { archiveId: 2, libraryArchiveUri: "wikg://lib/archive-2" },
      ],
      type: "triple",
    });
  });

  it("aggregates related items instead of returning the first archive", async () => {
    const { listRelatedWikiGraphLibraryObjects } =
      await import("../../../packages/core/src/library/query.js");

    mocks.objectArchiveIds.set("wikg://entity/Q1", [1, 2]);
    mocks.related.set("archive-1.wikg:wikg://entity/Q1", [
      createRelated("wikg://entity/Q2"),
    ]);
    mocks.related.set("archive-2.wikg:wikg://entity/Q1", [
      createRelated("wikg://entity/Q3"),
    ]);

    const result = await listRelatedWikiGraphLibraryObjects(
      target,
      "wikg://entity/Q1",
    );

    expect(result.items.map((item) => [item.id, item.archiveId])).toStrictEqual(
      [
        ["wikg://entity/Q2", 1],
        ["wikg://entity/Q3", 2],
      ],
    );
  });

  it("merges pack anchors and related items by archive id order", async () => {
    const { packWikiGraphLibraryContext } =
      await import("../../../packages/core/src/library/query.js");

    mocks.objectArchiveIds.set("wikg://entity/Q1", [1, 2]);
    mocks.packs.set("archive-1.wikg:wikg://entity/Q1", {
      anchor: createEntityPage("wikg://entity/Q1"),
      related: [createRelated("wikg://entity/Q2")],
    });
    mocks.packs.set("archive-2.wikg:wikg://entity/Q1", {
      anchor: createEntityPage("wikg://entity/Q1"),
      related: [createRelated("wikg://entity/Q3")],
    });

    const pack = await packWikiGraphLibraryContext(
      target,
      "wikg://entity/Q1",
      5000,
    );

    expect(pack.anchor).toMatchObject({
      sources: [
        { archiveId: 1, libraryArchiveUri: "wikg://lib/archive-1" },
        { archiveId: 2, libraryArchiveUri: "wikg://lib/archive-2" },
      ],
    });
    expect(pack.related.map((item) => [item.id, item.archiveId])).toStrictEqual(
      [
        ["wikg://entity/Q2", 1],
        ["wikg://entity/Q3", 2],
      ],
    );
  });

  it("fails the whole aggregation when an indexed archive is not readable", async () => {
    const { listWikiGraphLibraryEvidence } =
      await import("../../../packages/core/src/library/query.js");

    seedArchive(2, "removed");
    mocks.objectArchiveIds.set("wikg://entity/Q1", [1, 2]);
    mocks.evidence.set("archive-1.wikg:wikg://entity/Q1", [
      createEvidence("a", 1),
    ]);

    await expect(
      listWikiGraphLibraryEvidence(target, "wikg://entity/Q1"),
    ).rejects.toThrow("archive 2 is not readable");
  });

  it("lists library objects from the library index instead of archive collection merge", async () => {
    const [{ listWikiGraphLibraryObjects }, archiveView] = await Promise.all([
      import("../../../packages/core/src/library/query.js"),
      import("../../../packages/core/src/retrieval/query/archive-view/index.js"),
    ]);

    mocks.listIndexResult = {
      objectHits: [createIndexObjectHit(2, "1"), createIndexObjectHit(1, "1")],
      terms: [],
      textHits: [],
    };

    const result = await listWikiGraphLibraryObjects(target, {
      limit: 10,
      types: ["chapter-title"],
    });

    expect(archiveView.listArchiveCollection).not.toHaveBeenCalled();
    expect(result.items.map((item) => [item.id, item.archiveId])).toStrictEqual(
      [
        ["wikg://chapter/1/title", 1],
        ["wikg://chapter/1/title", 2],
      ],
    );
  });

  it("requests text sentence hits only for text-stream library list types", async () => {
    const [{ listWikiGraphLibraryObjects }, searchIndex] = await Promise.all([
      import("../../../packages/core/src/library/query.js"),
      import("../../../packages/core/src/library/search-index.js"),
    ]);

    await listWikiGraphLibraryObjects(target, { types: ["source"] });

    expect(searchIndex.listWikiGraphLibrarySearchIndex).toHaveBeenCalledWith(
      target,
      { includeText: true },
    );
  });
});

function createIndexObjectHit(archiveId: number, ownerId: string) {
  return {
    archiveId,
    archiveUri: `wikg://lib/archive-${archiveId}`,
    chapterId: Number(ownerId),
    libraryArchiveUri: `wikg://lib/archive-${archiveId}`,
    ownerId,
    ownerKind: 1,
    propertyKind: 1,
    score: 0,
  };
}

function createEntityPage(id: string) {
  return {
    evidence: { nextCursor: null, shown: 0, sources: [], total: 0 },
    id,
    label: id,
    labels: [id],
    mentionCount: 1,
    qid: "Q1",
    type: "entity" as const,
  };
}

function createEvidence(id: string, startSentenceIndex: number) {
  return {
    chapterId: 1,
    endSentenceIndex: startSentenceIndex,
    id,
    source: id,
    startSentenceIndex,
    title: id,
    type: "source" as const,
  };
}

function createRelated(id: string) {
  return {
    id,
    label: id,
    summary: id,
    type: "entity" as const,
  };
}
