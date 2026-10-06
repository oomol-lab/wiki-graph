import {
  isArchiveSearchIndexCurrent,
  listChapters,
  type ChapterEntry,
  type IndexArtifactCoverageRecord,
  type IndexArtifactKind,
  type ReadonlyDocument,
} from "wiki-graph-core";

export interface WikiGraphArchiveIndexArtifactInspection {
  readonly current: boolean;
  readonly exists: boolean;
  readonly kind: IndexArtifactKind;
  readonly sourceRevision?: number;
}

export interface WikiGraphArchiveChapterInspection {
  readonly capabilities: {
    readonly knowledgeGraph: { readonly completed: boolean };
    readonly readingGraph: { readonly completed: boolean };
    readonly readingSummary: { readonly completed: boolean };
  };
  readonly chapter: ChapterEntry;
  readonly indexes: {
    readonly fts: WikiGraphArchiveIndexArtifactInspection;
    readonly sourceEmbedding: WikiGraphArchiveIndexArtifactInspection;
    readonly summaryEmbedding: WikiGraphArchiveIndexArtifactInspection;
  };
  readonly revision: number;
  readonly summaryWords: number;
}

export interface WikiGraphArchiveInspection {
  readonly archiveUri: string;
  readonly chapters: readonly WikiGraphArchiveChapterInspection[];
  readonly localIndexCache: { readonly current: boolean };
  readonly scope: {
    readonly chapterId?: number;
    readonly type: "archive" | "chapter";
  };
  readonly uri: string;
}

export async function inspectWikiGraphArchive(
  document: ReadonlyDocument,
  options: {
    readonly archiveUri: string;
    readonly chapterId?: number;
  },
): Promise<WikiGraphArchiveInspection> {
  const [allChapters, indexCacheCurrent, summaryWords, ...coverage] =
    await Promise.all([
      listChapters(document),
      isArchiveSearchIndexCurrent(document),
      readSummaryWords(document),
      document.indexArtifacts.listCoverage("fts"),
      document.indexArtifacts.listCoverage("embedding-source"),
      document.indexArtifacts.listCoverage("embedding-summary"),
    ]);
  const chapters = selectChapters(allChapters, options.chapterId);
  const coverageByKind = {
    fts: byChapterId(coverage[0]),
    sourceEmbedding: byChapterId(coverage[1]),
    summaryEmbedding: byChapterId(coverage[2]),
  };
  const inspections = await Promise.all(
    chapters.map(async (chapter) => {
      const serial = await document.serials.getById(chapter.chapterId);
      return {
        capabilities: {
          knowledgeGraph: {
            completed: serial?.knowledgeGraphReady === true,
          },
          readingGraph: { completed: serial?.topologyReady === true },
          readingSummary: { completed: chapter.stage === "summarized" },
        },
        chapter,
        indexes: {
          fts: inspectArtifact(
            "fts",
            coverageByKind.fts.get(chapter.chapterId),
          ),
          sourceEmbedding: inspectArtifact(
            "embedding-source",
            coverageByKind.sourceEmbedding.get(chapter.chapterId),
          ),
          summaryEmbedding: inspectArtifact(
            "embedding-summary",
            coverageByKind.summaryEmbedding.get(chapter.chapterId),
          ),
        },
        revision: serial?.revision ?? 0,
        summaryWords: summaryWords.get(chapter.chapterId) ?? 0,
      } satisfies WikiGraphArchiveChapterInspection;
    }),
  );
  const selected = inspections[0];
  return {
    archiveUri: options.archiveUri,
    chapters: inspections,
    localIndexCache: { current: indexCacheCurrent },
    scope:
      options.chapterId === undefined
        ? { type: "archive" }
        : { chapterId: options.chapterId, type: "chapter" },
    uri:
      selected === undefined || options.chapterId === undefined
        ? options.archiveUri
        : formatLocatedChapterUri(options.archiveUri, selected.chapter),
  };
}

function selectChapters(
  chapters: readonly ChapterEntry[],
  chapterId: number | undefined,
): readonly ChapterEntry[] {
  if (chapterId === undefined) return chapters;
  const selected = chapters.filter(
    (chapter) => chapter.chapterId === chapterId,
  );
  if (selected.length === 0) {
    throw new Error(`Chapter ${chapterId} does not exist.`);
  }
  return selected;
}

function byChapterId(
  coverage: readonly IndexArtifactCoverageRecord[],
): ReadonlyMap<number, IndexArtifactCoverageRecord> {
  return new Map(coverage.map((item) => [item.serialId, item]));
}

function inspectArtifact(
  kind: IndexArtifactKind,
  coverage: IndexArtifactCoverageRecord | undefined,
): WikiGraphArchiveIndexArtifactInspection {
  return {
    current: coverage?.current === true,
    exists: coverage?.sourceRevision !== undefined,
    kind,
    ...(coverage?.sourceRevision === undefined
      ? {}
      : { sourceRevision: coverage.sourceRevision }),
  };
}

async function readSummaryWords(
  document: ReadonlyDocument,
): Promise<ReadonlyMap<number, number>> {
  const rows = await document.readDatabase(
    async (database) =>
      await database.queryAll(
        `
        SELECT chapter_id, COALESCE(SUM(words_count), 0) AS words
        FROM text_sentence_records
        WHERE kind = 2
        GROUP BY chapter_id
      `,
        undefined,
        (row) => ({
          chapterId: Number(row.chapter_id),
          words: Number(row.words),
        }),
      ),
  );
  return new Map(rows.map((row) => [row.chapterId, row.words]));
}

function formatLocatedChapterUri(
  archiveUri: string,
  chapter: Pick<ChapterEntry, "uri">,
): string {
  return `${archiveUri.replace(/\/+$/u, "")}/${chapter.uri.replace(/^wikg:\/\//u, "")}`;
}
