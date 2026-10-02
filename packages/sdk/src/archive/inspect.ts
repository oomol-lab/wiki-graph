import {
  isArchiveSearchIndexCurrent,
  listChapters,
  type BuildJobTarget,
  type ChapterEntry,
  type IndexArtifactCoverageRecord,
  type ReadonlyDocument,
} from "wiki-graph-core";
import {
  createGenerationPerformanceHints,
  DEFAULT_GENERATION_JOB_CONCURRENCY,
  DEFAULT_GENERATION_REQUEST_CONCURRENCY,
  formatGenerationPlanningModel,
  planGenerationTask,
  type GenerationPerformanceHint,
  type GenerationPlanningCost,
} from "../planning.js";
import { loadWikiGraphRuntimeConfig } from "../runtime-config.js";

interface InspectChapter extends ChapterEntry {
  readonly knowledgeGraphReady: boolean;
  readonly readingGraphReady: boolean;
  readonly summaryReady: boolean;
}

export interface WikiGraphArchiveInspectImprovement {
  readonly kind: "add-source" | "build" | "sync-index";
  readonly missingChapters?: number;
  readonly missingWords?: number;
  readonly planning?: GenerationPlanningCost;
  readonly recommendation: string;
  readonly task?: BuildJobTarget;
  readonly title: string;
}

export interface WikiGraphArchiveInspectCoverage {
  readonly coveredChapters: number;
  readonly coveredWords: number;
  readonly percent: string;
  readonly totalChapters: number;
  readonly totalWords: number;
}

export interface WikiGraphArchiveInspectChapterReference {
  readonly chapterId: number;
  readonly locatedUri: string;
  readonly title: string | null;
  readonly uri: string;
}

export interface WikiGraphArchiveInspectReport {
  readonly archiveUri: string;
  readonly uri: string;
  readonly scope: {
    readonly chapterId?: number;
    readonly type: "archive" | "chapter";
  };
  readonly content: {
    readonly chapters: {
      readonly content: number;
      readonly planned: number;
      readonly total: number;
    };
    readonly sourceWords: number;
    readonly summaryWords: number;
  };
  readonly localIndexCache: {
    readonly blockedBy?: "missing-search-artifacts";
    readonly current: boolean;
    readonly impact?: string;
    readonly resource?: string;
    readonly status: "blocked" | "current" | "missing-or-outdated";
    readonly syncAvailable: boolean;
  };
  readonly coverage: {
    readonly ftsIndexArtifact: WikiGraphArchiveInspectCoverage;
    readonly knowledgeGraph: WikiGraphArchiveInspectCoverage;
    readonly readingGraph: WikiGraphArchiveInspectCoverage;
    readonly summary: WikiGraphArchiveInspectCoverage;
    readonly summaryEmbeddingIndexArtifact: WikiGraphArchiveInspectCoverage;
    readonly sourceEmbeddingIndexArtifact: WikiGraphArchiveInspectCoverage;
  };
  readonly query: {
    readonly ready: boolean;
  };
  readonly searchArtifacts: {
    readonly blockedChapters: readonly WikiGraphArchiveInspectChapterReference[];
    readonly ready: boolean;
    readonly resource?: string;
    readonly status: "incomplete" | "ready";
  };
  readonly retrievalGuidance: readonly string[];
  readonly improvements: readonly WikiGraphArchiveInspectImprovement[];
  readonly performanceHints: readonly GenerationPerformanceHint[];
  readonly summaryCoverageNote: string;
}

export async function createWikiGraphArchiveInspectReport(
  document: ReadonlyDocument,
  options: {
    readonly archiveUri: string;
    readonly chapterId?: number;
  },
): Promise<WikiGraphArchiveInspectReport> {
  const { archiveUri } = options;
  const [
    chapters,
    summaryWords,
    indexCacheCurrent,
    config,
    ftsArtifactCoverage,
    sourceEmbeddingArtifactCoverage,
    summaryEmbeddingArtifactCoverage,
  ] = await Promise.all([
    readInspectChapters(document, options.chapterId),
    readSummaryWords(document, options.chapterId),
    isArchiveSearchIndexCurrent(document),
    loadWikiGraphRuntimeConfig(),
    readIndexArtifactCoverage(document, "fts", options.chapterId),
    readIndexArtifactCoverage(document, "embedding-source", options.chapterId),
    readIndexArtifactCoverage(document, "embedding-summary", options.chapterId),
  ]);
  const selectedChapter =
    options.chapterId === undefined ? undefined : chapters[0];
  const scopeUri =
    selectedChapter === undefined
      ? archiveUri
      : formatInspectLocatedChapterUri(archiveUri, selectedChapter);
  const concurrent = {
    job: config.concurrent?.job ?? DEFAULT_GENERATION_JOB_CONCURRENCY,
    request:
      config.concurrent?.request ?? DEFAULT_GENERATION_REQUEST_CONCURRENCY,
  };
  const planningModel = formatGenerationPlanningModel(config.llm);
  const contentChapters = chapters.filter(
    (chapter) => chapter.stage !== "planned",
  );
  const sourceWords = sumWords(contentChapters);
  const readingGraphCovered = contentChapters.filter(
    (chapter) => chapter.readingGraphReady,
  );
  const knowledgeGraphCovered = contentChapters.filter(
    (chapter) => chapter.knowledgeGraphReady,
  );
  const summaryCovered = contentChapters.filter(
    (chapter) => chapter.summaryReady,
  );
  const ftsArtifactCovered = filterChaptersByCurrentIndexArtifact(
    contentChapters,
    ftsArtifactCoverage,
  );
  const sourceEmbeddingArtifactCovered = filterChaptersByCurrentIndexArtifact(
    contentChapters,
    sourceEmbeddingArtifactCoverage,
  );
  const summaryEmbeddingArtifactCovered = filterChaptersByCurrentIndexArtifact(
    contentChapters,
    summaryEmbeddingArtifactCoverage,
  );
  const queryBlockedContentChapters = contentChapters.filter(
    (chapter) =>
      !ftsArtifactCovered.includes(chapter) &&
      !sourceEmbeddingArtifactCovered.includes(chapter),
  );
  const queryBlockedChapters = queryBlockedContentChapters.map((chapter) =>
    createInspectChapterReference(archiveUri, chapter),
  );
  const queryReady = queryBlockedChapters.length === 0;
  const improvements = createInspectImprovements({
    concurrent,
    contentChapters,
    indexCacheCurrent,
    planningModel,
    queryBlockedChapters: queryBlockedContentChapters,
    summaryCovered,
    knowledgeGraphCovered,
    readingGraphCovered,
  });
  const performanceHints = createGenerationPerformanceHints({
    chapters: Math.max(
      0,
      ...improvements.map((improvement) => improvement.missingChapters ?? 0),
    ),
    concurrent,
    hasJobWork: improvements.some(
      (improvement) => improvement.planning !== undefined,
    ),
    hasRequestWork: improvements.some(
      (improvement) => improvement.planning !== undefined,
    ),
  });

  return {
    archiveUri,
    uri: scopeUri,
    scope:
      options.chapterId === undefined
        ? { type: "archive" }
        : { chapterId: options.chapterId, type: "chapter" },
    content: {
      chapters: {
        content: contentChapters.length,
        planned: chapters.length - contentChapters.length,
        total: chapters.length,
      },
      sourceWords,
      summaryWords,
    },
    localIndexCache: {
      current: indexCacheCurrent,
      ...(!queryReady
        ? {
            blockedBy: "missing-search-artifacts" as const,
            impact:
              "The cache cannot be built until every content chapter has a current FTS or source embedding artifact.",
          }
        : indexCacheCurrent
          ? {}
          : {
              impact:
                "The next archive query may need to sync index cache first.",
              resource: "local CPU/disk time only; no provider calls.",
            }),
      status: !queryReady
        ? "blocked"
        : indexCacheCurrent
          ? "current"
          : "missing-or-outdated",
      syncAvailable: queryReady && !indexCacheCurrent,
    },
    coverage: {
      ftsIndexArtifact: createInspectCoverage(
        ftsArtifactCovered,
        contentChapters,
      ),
      knowledgeGraph: createInspectCoverage(
        knowledgeGraphCovered,
        contentChapters,
      ),
      readingGraph: createInspectCoverage(readingGraphCovered, contentChapters),
      summary: createInspectCoverage(summaryCovered, contentChapters),
      sourceEmbeddingIndexArtifact: createInspectCoverage(
        sourceEmbeddingArtifactCovered,
        contentChapters,
      ),
      summaryEmbeddingIndexArtifact: createInspectCoverage(
        summaryEmbeddingArtifactCovered,
        contentChapters,
      ),
    },
    query: {
      ready: queryReady,
    },
    searchArtifacts: {
      blockedChapters: queryBlockedChapters,
      ...(!queryReady
        ? {
            resource: "local CPU/disk time only; no provider calls.",
          }
        : {}),
      ready: queryReady,
      status: queryReady ? "ready" : "incomplete",
    },
    retrievalGuidance: formatRetrievalGuidance({
      indexCacheCurrent,
      knowledgeGraphCovered,
      readingGraphCovered,
      contentChapters,
      queryReady,
      sourceWords,
    }),
    improvements,
    performanceHints,
    summaryCoverageNote:
      "Summary coverage means a current summary artifact exists for the chapter; it does not guarantee that every source topic is represented in the summary text.",
  };
}

function createInspectChapterReference(
  archiveUri: string,
  chapter: ChapterEntry,
): WikiGraphArchiveInspectChapterReference {
  return {
    chapterId: chapter.chapterId,
    locatedUri: formatInspectLocatedChapterUri(archiveUri, chapter),
    title: chapter.title,
    uri: chapter.uri,
  };
}

function formatInspectLocatedChapterUri(
  archiveUri: string,
  chapter: Pick<ChapterEntry, "uri">,
): string {
  return `${archiveUri.replace(/\/+$/u, "")}/${chapter.uri.replace(/^wikg:\/\//u, "")}`;
}

async function readInspectChapters(
  document: ReadonlyDocument,
  chapterId: number | undefined,
): Promise<readonly InspectChapter[]> {
  const chapters =
    chapterId === undefined
      ? await listChapters(document)
      : (await listChapters(document)).filter(
          (chapter) => chapter.chapterId === chapterId,
        );

  if (chapterId !== undefined && chapters.length === 0) {
    throw new Error(`Chapter ${chapterId} does not exist.`);
  }

  return await Promise.all(
    chapters.map(async (chapter) => {
      const serial = await document.serials.getById(chapter.chapterId);

      return {
        ...chapter,
        knowledgeGraphReady: serial?.knowledgeGraphReady === true,
        readingGraphReady: serial?.topologyReady === true,
        summaryReady: chapter.stage === "summarized",
      };
    }),
  );
}

async function readSummaryWords(
  document: ReadonlyDocument,
  chapterId: number | undefined,
): Promise<number> {
  return await document.readDatabase(
    async (database) =>
      (await database.queryOne(
        `
          SELECT COALESCE(SUM(words_count), 0) AS words
          FROM text_sentence_records
          WHERE kind = 2
            ${chapterId === undefined ? "" : "AND chapter_id = ?"}
        `,
        chapterId === undefined ? undefined : [chapterId],
        (row) => Number(row.words),
      )) ?? 0,
  );
}

async function readIndexArtifactCoverage(
  document: ReadonlyDocument,
  kind: "embedding-source" | "embedding-summary" | "fts",
  chapterId: number | undefined,
): Promise<readonly IndexArtifactCoverageRecord[]> {
  const coverage = await document.indexArtifacts.listCoverage(kind);

  return chapterId === undefined
    ? coverage
    : coverage.filter((item) => item.serialId === chapterId);
}

function filterChaptersByCurrentIndexArtifact(
  chapters: readonly InspectChapter[],
  coverage: readonly IndexArtifactCoverageRecord[],
): readonly InspectChapter[] {
  const currentChapterIds = new Set(
    coverage.filter((item) => item.current).map((item) => item.serialId),
  );

  return chapters.filter((chapter) => currentChapterIds.has(chapter.chapterId));
}

function createInspectCoverage(
  covered: readonly InspectChapter[],
  total: readonly InspectChapter[],
): WikiGraphArchiveInspectCoverage {
  const coveredWords = sumWords(covered);
  const totalWords = sumWords(total);

  return {
    coveredChapters: covered.length,
    coveredWords,
    percent: formatPercent(coveredWords, totalWords),
    totalChapters: total.length,
    totalWords,
  };
}

function formatRetrievalGuidance(input: {
  readonly contentChapters: readonly InspectChapter[];
  readonly indexCacheCurrent: boolean;
  readonly knowledgeGraphCovered: readonly InspectChapter[];
  readonly queryReady: boolean;
  readonly readingGraphCovered: readonly InspectChapter[];
  readonly sourceWords: number;
}): readonly string[] {
  if (input.sourceWords === 0 || input.contentChapters.length === 0) {
    return [
      "Source content: empty.",
      "Add source text before using query coverage or graph-based retrieval.",
    ];
  }

  const lines = [
    input.queryReady
      ? `Query: available; local index cache is ${input.indexCacheCurrent ? "current" : "missing or outdated and can be synced from artifacts"}.`
      : "Query: unavailable until every content chapter has a current FTS or source embedding artifact.",
  ];

  lines.push(
    formatObjectSearchGuidance(
      "Reading Graph object retrieval",
      input.readingGraphCovered,
      input.contentChapters,
    ),
  );
  lines.push(
    formatObjectSearchGuidance(
      "Entity/triple retrieval",
      input.knowledgeGraphCovered,
      input.contentChapters,
    ),
  );

  return lines;
}

function formatObjectSearchGuidance(
  label: string,
  covered: readonly InspectChapter[],
  total: readonly InspectChapter[],
): string {
  const coveredWords = sumWords(covered);
  const totalWords = sumWords(total);
  const ratio = totalWords === 0 ? 0 : coveredWords / totalWords;
  const coverage = formatPercent(coveredWords, totalWords);

  if (ratio >= 1) {
    return `${label}: covers all source content; it can represent the full scope for object retrieval.`;
  }
  if (ratio >= 0.9) {
    return `${label}: covers ${coverage}; use it as the main path, but source --query is needed for uncovered content.`;
  }
  if (ratio >= 0.5) {
    return `${label}: covers ${coverage}; use it as leads, not as a full-scope substitute for source --query.`;
  }

  return `${label}: covers ${coverage}; build missing graph coverage before relying on object retrieval.`;
}

function createInspectImprovements(input: {
  readonly concurrent: { readonly job: number; readonly request: number };
  readonly contentChapters: readonly InspectChapter[];
  readonly indexCacheCurrent: boolean;
  readonly knowledgeGraphCovered: readonly InspectChapter[];
  readonly planningModel: string;
  readonly queryBlockedChapters: readonly InspectChapter[];
  readonly readingGraphCovered: readonly InspectChapter[];
  readonly summaryCovered: readonly InspectChapter[];
}): readonly WikiGraphArchiveInspectImprovement[] {
  const improvements: WikiGraphArchiveInspectImprovement[] = [];

  if (input.contentChapters.length === 0) {
    improvements.push({
      kind: "add-source",
      recommendation:
        "No source content is available yet; add or import source text before graph or summary generation.",
      title: "Add source content",
    });
    return improvements;
  }

  if (input.queryBlockedChapters.length > 0) {
    improvements.push({
      kind: "build",
      missingChapters: input.queryBlockedChapters.length,
      missingWords: sumWords(input.queryBlockedChapters),
      recommendation:
        "Build local FTS artifacts to make this scope queryable. This does not call a provider.",
      task: "index-fts",
      title: "Enable query with local FTS",
    });
  } else if (!input.indexCacheCurrent) {
    improvements.push({
      kind: "sync-index",
      recommendation:
        "Sync the index cache from chapter index artifacts so query starts without a lazy cache rebuild.",
      title: "Sync index cache",
    });
  }

  improvements.push(
    ...createGraphImprovement({
      concurrent: input.concurrent,
      covered: input.readingGraphCovered,
      planningModel: input.planningModel,
      task: "reading-graph",
      title: "Complete Reading Graph coverage",
      total: input.contentChapters,
    }),
  );
  improvements.push(
    ...createGraphImprovement({
      concurrent: input.concurrent,
      covered: input.knowledgeGraphCovered,
      planningModel: input.planningModel,
      task: "knowledge-graph",
      title: "Complete Knowledge Graph coverage",
      total: input.contentChapters,
    }),
  );
  improvements.push(
    ...createGraphImprovement({
      concurrent: input.concurrent,
      covered: input.summaryCovered,
      planningModel: input.planningModel,
      task: "reading-summary",
      title: "Complete Summary coverage",
      total: input.contentChapters,
    }),
  );

  return improvements;
}

function createGraphImprovement(input: {
  readonly concurrent: { readonly job: number; readonly request: number };
  readonly covered: readonly InspectChapter[];
  readonly planningModel: string;
  readonly task: "knowledge-graph" | "reading-graph" | "reading-summary";
  readonly title: string;
  readonly total: readonly InspectChapter[];
}): readonly WikiGraphArchiveInspectImprovement[] {
  const coveredIds = new Set(input.covered.map((chapter) => chapter.chapterId));
  const missing = input.total.filter(
    (chapter) => !coveredIds.has(chapter.chapterId),
  );

  if (missing.length === 0) {
    return [];
  }

  const missingWords = sumWords(missing);

  return [
    {
      kind: "build",
      missingChapters: missing.length,
      missingWords,
      planning: planGenerationTask(
        input.task,
        missingWords,
        missing.length,
        input.concurrent,
        input.planningModel,
      ),
      recommendation: formatImprovementRecommendation(
        input.covered,
        input.total,
        missingWords,
      ),
      task: input.task,
      title: input.title,
    },
  ];
}

function formatImprovementRecommendation(
  covered: readonly InspectChapter[],
  total: readonly InspectChapter[],
  missingWords: number,
): string {
  const totalWords = sumWords(total);
  const coveredWords = sumWords(covered);

  if (totalWords === 0) {
    return "No source content is available.";
  }
  if (
    total.length === 1 ||
    coveredWords / totalWords >= 0.9 ||
    missingWords <= 1000
  ) {
    return "Queue the full scope to finish the remaining gap.";
  }

  return "Queue selected chapters first if only part of the scope matters.";
}

function sumWords(chapters: readonly Pick<InspectChapter, "words">[]): number {
  return chapters.reduce((total, chapter) => total + chapter.words, 0);
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "n/a";
  }

  const percent = (numerator / denominator) * 100;

  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}
