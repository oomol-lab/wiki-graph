import type {
  BuildJobTarget,
  GenerationPerformanceHint,
  GenerationPlanningCost,
  WikiGraphArchiveChapterInspection,
  WikiGraphArchiveInspection,
} from "wiki-graph-sdk";
import {
  createGenerationPerformanceHints,
  DEFAULT_GENERATION_JOB_CONCURRENCY,
  DEFAULT_GENERATION_REQUEST_CONCURRENCY,
  formatGenerationPlanningModel,
  loadWikiGraphRuntimeConfig,
  planGenerationTask,
} from "wiki-graph-sdk";

import type { CLIArchiveArguments } from "../../args/index.js";
import {
  formatGenerationPlanningDuration,
  toCLIGenerationPerformanceHints,
  type CLIGenerationPerformanceHint,
} from "../../runtime/index.js";
import { getWikiGraphSDK } from "../../runtime/context.js";
import {
  formatCLIJSON,
  formatCliCommand,
  writeTextToStdout,
} from "../../support/index.js";

interface InspectImprovement {
  readonly kind: "add-source" | "build" | "sync-index";
  readonly missingChapters?: number;
  readonly missingWords?: number;
  readonly planning?: GenerationPlanningCost;
  readonly recommendation: string;
  readonly task?: BuildJobTarget;
  readonly title: string;
}

interface InspectCoverage {
  readonly coveredChapters: number;
  readonly coveredWords: number;
  readonly percent: string;
  readonly totalChapters: number;
  readonly totalWords: number;
}

interface InspectChapterReference {
  readonly chapterId: number;
  readonly locatedUri: string;
  readonly title: string | null;
  readonly uri: string;
}

interface InspectReport {
  readonly archiveUri: string;
  readonly content: {
    readonly chapters: {
      readonly content: number;
      readonly planned: number;
      readonly total: number;
    };
    readonly sourceWords: number;
    readonly summaryWords: number;
  };
  readonly coverage: {
    readonly ftsIndexArtifact: InspectCoverage;
    readonly knowledgeGraph: InspectCoverage;
    readonly readingGraph: InspectCoverage;
    readonly sourceEmbeddingIndexArtifact: InspectCoverage;
    readonly summary: InspectCoverage;
    readonly summaryEmbeddingIndexArtifact: InspectCoverage;
  };
  readonly improvements: readonly InspectImprovement[];
  readonly localIndexCache: {
    readonly blockedBy?: "missing-search-artifacts";
    readonly current: boolean;
    readonly impact?: string;
    readonly resource?: string;
    readonly status: "blocked" | "current" | "missing-or-outdated";
    readonly syncAvailable: boolean;
  };
  readonly performanceHints: readonly GenerationPerformanceHint[];
  readonly query: { readonly ready: boolean };
  readonly retrievalGuidance: readonly string[];
  readonly scope: WikiGraphArchiveInspection["scope"];
  readonly searchArtifacts: {
    readonly blockedChapters: readonly InspectChapterReference[];
    readonly ready: boolean;
    readonly resource?: string;
    readonly status: "incomplete" | "ready";
  };
  readonly summaryCoverageNote: string;
  readonly uri: string;
}

interface CLIInspectImprovement extends InspectImprovement {
  readonly command: string;
}

interface CLIInspectReport extends Omit<
  InspectReport,
  "archiveUri" | "improvements" | "performanceHints" | "summaryCoverageNote"
> {
  readonly localIndexCache: InspectReport["localIndexCache"] & {
    readonly fixCommand?: string;
  };
  readonly searchArtifacts: InspectReport["searchArtifacts"] & {
    readonly fixCommand?: string;
    readonly helpCommand: string;
  };
  readonly improvements: readonly CLIInspectImprovement[];
  readonly performanceHints: readonly CLIGenerationPerformanceHint[];
  readonly help: {
    readonly readiness: string;
    readonly summaryCoverage: string;
  };
}

export async function writeArchiveInspectReport(
  args: CLIArchiveArguments,
): Promise<void> {
  const archive = await getWikiGraphSDK().archives.open(args.archivePath);
  const report = toCLIInspectReport(
    await createInspectReport(
      await archive.inspect({
        ...(args.chapterId === undefined ? {} : { chapterId: args.chapterId }),
      }),
    ),
  );

  await writeTextToStdout(
    args.json === true
      ? formatCLIJSON(report)
      : formatArchiveInspectText(report),
  );
}

async function createInspectReport(
  inspection: WikiGraphArchiveInspection,
): Promise<InspectReport> {
  const config = await loadWikiGraphRuntimeConfig();
  const chapters = inspection.chapters;
  const contentChapters = chapters.filter(
    ({ chapter }) => chapter.stage !== "planned",
  );
  const readingGraphCovered = contentChapters.filter(
    ({ capabilities }) => capabilities.readingGraph.completed,
  );
  const knowledgeGraphCovered = contentChapters.filter(
    ({ capabilities }) => capabilities.knowledgeGraph.completed,
  );
  const summaryCovered = contentChapters.filter(
    ({ capabilities }) => capabilities.readingSummary.completed,
  );
  const ftsArtifactCovered = contentChapters.filter(
    ({ indexes }) => indexes.fts.current,
  );
  const sourceEmbeddingArtifactCovered = contentChapters.filter(
    ({ indexes }) => indexes.sourceEmbedding.current,
  );
  const summaryEmbeddingArtifactCovered = contentChapters.filter(
    ({ indexes }) => indexes.summaryEmbedding.current,
  );
  const queryBlockedChapters = contentChapters.filter(
    (chapter) =>
      !ftsArtifactCovered.includes(chapter) &&
      !sourceEmbeddingArtifactCovered.includes(chapter),
  );
  const queryReady = queryBlockedChapters.length === 0;
  const concurrent = {
    job: config.concurrent?.job ?? DEFAULT_GENERATION_JOB_CONCURRENCY,
    request:
      config.concurrent?.request ?? DEFAULT_GENERATION_REQUEST_CONCURRENCY,
  };
  const improvements = createInspectImprovements({
    concurrent,
    contentChapters,
    indexCacheCurrent: inspection.localIndexCache.current,
    knowledgeGraphCovered,
    planningModel: formatGenerationPlanningModel(config.llm),
    queryBlockedChapters,
    readingGraphCovered,
    summaryCovered,
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
  const sourceWords = sumWords(contentChapters);
  const indexCacheCurrent = inspection.localIndexCache.current;

  return {
    archiveUri: inspection.archiveUri,
    content: {
      chapters: {
        content: contentChapters.length,
        planned: chapters.length - contentChapters.length,
        total: chapters.length,
      },
      sourceWords,
      summaryWords: chapters.reduce(
        (total, chapter) => total + chapter.summaryWords,
        0,
      ),
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
      sourceEmbeddingIndexArtifact: createInspectCoverage(
        sourceEmbeddingArtifactCovered,
        contentChapters,
      ),
      summary: createInspectCoverage(summaryCovered, contentChapters),
      summaryEmbeddingIndexArtifact: createInspectCoverage(
        summaryEmbeddingArtifactCovered,
        contentChapters,
      ),
    },
    improvements,
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
    performanceHints,
    query: { ready: queryReady },
    retrievalGuidance: formatRetrievalGuidance({
      contentChapters,
      indexCacheCurrent,
      knowledgeGraphCovered,
      queryReady,
      readingGraphCovered,
      sourceWords,
    }),
    scope: inspection.scope,
    searchArtifacts: {
      blockedChapters: queryBlockedChapters.map((item) =>
        createInspectChapterReference(inspection.archiveUri, item),
      ),
      ...(!queryReady
        ? { resource: "local CPU/disk time only; no provider calls." }
        : {}),
      ready: queryReady,
      status: queryReady ? "ready" : "incomplete",
    },
    summaryCoverageNote:
      "Summary coverage means a current summary artifact exists for the chapter; it does not guarantee that every source topic is represented in the summary text.",
    uri: inspection.uri,
  };
}

function createInspectChapterReference(
  archiveUri: string,
  inspection: WikiGraphArchiveChapterInspection,
): InspectChapterReference {
  return {
    chapterId: inspection.chapter.chapterId,
    locatedUri: `${archiveUri.replace(/\/+$/u, "")}/${inspection.chapter.uri.replace(/^wikg:\/\//u, "")}`,
    title: inspection.chapter.title,
    uri: inspection.chapter.uri,
  };
}

function createInspectCoverage(
  covered: readonly WikiGraphArchiveChapterInspection[],
  total: readonly WikiGraphArchiveChapterInspection[],
): InspectCoverage {
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

function createInspectImprovements(input: {
  readonly concurrent: { readonly job: number; readonly request: number };
  readonly contentChapters: readonly WikiGraphArchiveChapterInspection[];
  readonly indexCacheCurrent: boolean;
  readonly knowledgeGraphCovered: readonly WikiGraphArchiveChapterInspection[];
  readonly planningModel: string;
  readonly queryBlockedChapters: readonly WikiGraphArchiveChapterInspection[];
  readonly readingGraphCovered: readonly WikiGraphArchiveChapterInspection[];
  readonly summaryCovered: readonly WikiGraphArchiveChapterInspection[];
}): readonly InspectImprovement[] {
  if (input.contentChapters.length === 0) {
    return [
      {
        kind: "add-source",
        recommendation:
          "No source content is available yet; add or import source text before graph or summary generation.",
        title: "Add source content",
      },
    ];
  }

  const improvements: InspectImprovement[] = [];
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
    ...createGraphImprovement({
      concurrent: input.concurrent,
      covered: input.knowledgeGraphCovered,
      planningModel: input.planningModel,
      task: "knowledge-graph",
      title: "Complete Knowledge Graph coverage",
      total: input.contentChapters,
    }),
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
  readonly covered: readonly WikiGraphArchiveChapterInspection[];
  readonly planningModel: string;
  readonly task: "knowledge-graph" | "reading-graph" | "reading-summary";
  readonly title: string;
  readonly total: readonly WikiGraphArchiveChapterInspection[];
}): readonly InspectImprovement[] {
  const coveredIds = new Set(
    input.covered.map(({ chapter }) => chapter.chapterId),
  );
  const missing = input.total.filter(
    ({ chapter }) => !coveredIds.has(chapter.chapterId),
  );
  if (missing.length === 0) return [];
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
  covered: readonly WikiGraphArchiveChapterInspection[],
  total: readonly WikiGraphArchiveChapterInspection[],
  missingWords: number,
): string {
  const totalWords = sumWords(total);
  const coveredWords = sumWords(covered);
  if (totalWords === 0) return "No source content is available.";
  if (
    total.length === 1 ||
    coveredWords / totalWords >= 0.9 ||
    missingWords <= 1000
  ) {
    return "Queue the full scope to finish the remaining gap.";
  }
  return "Queue selected chapters first if only part of the scope matters.";
}

function formatRetrievalGuidance(input: {
  readonly contentChapters: readonly WikiGraphArchiveChapterInspection[];
  readonly indexCacheCurrent: boolean;
  readonly knowledgeGraphCovered: readonly WikiGraphArchiveChapterInspection[];
  readonly queryReady: boolean;
  readonly readingGraphCovered: readonly WikiGraphArchiveChapterInspection[];
  readonly sourceWords: number;
}): readonly string[] {
  if (input.sourceWords === 0 || input.contentChapters.length === 0) {
    return [
      "Source content: empty.",
      "Add source text before using query coverage or graph-based retrieval.",
    ];
  }
  return [
    input.queryReady
      ? `Query: available; local index cache is ${input.indexCacheCurrent ? "current" : "missing or outdated and can be synced from artifacts"}.`
      : "Query: unavailable until every content chapter has a current FTS or source embedding artifact.",
    formatObjectSearchGuidance(
      "Reading Graph object retrieval",
      input.readingGraphCovered,
      input.contentChapters,
    ),
    formatObjectSearchGuidance(
      "Entity/triple retrieval",
      input.knowledgeGraphCovered,
      input.contentChapters,
    ),
  ];
}

function formatObjectSearchGuidance(
  label: string,
  covered: readonly WikiGraphArchiveChapterInspection[],
  total: readonly WikiGraphArchiveChapterInspection[],
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

function sumWords(
  chapters: readonly WikiGraphArchiveChapterInspection[],
): number {
  return chapters.reduce((total, { chapter }) => total + chapter.words, 0);
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  const percent = (numerator / denominator) * 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function toCLIInspectReport(report: InspectReport): CLIInspectReport {
  const { archiveUri, summaryCoverageNote, ...base } = report;
  return {
    ...base,
    localIndexCache: {
      ...report.localIndexCache,
      ...(report.localIndexCache.syncAvailable
        ? { fixCommand: formatCliCommand([`${archiveUri}/index`, "sync"]) }
        : {}),
    },
    searchArtifacts: {
      ...report.searchArtifacts,
      ...(report.searchArtifacts.ready
        ? {}
        : {
            fixCommand: formatBuildCommand(report.uri, "index-fts", false),
          }),
      helpCommand: "wg help readiness",
    },
    improvements: report.improvements.map((improvement) => ({
      ...improvement,
      command: formatImprovementCommand(improvement, archiveUri, report.uri),
    })),
    performanceHints: toCLIGenerationPerformanceHints(report.performanceHints),
    help: {
      readiness: "wg help readiness",
      summaryCoverage: summaryCoverageNote,
    },
  };
}

function formatImprovementCommand(
  improvement: InspectImprovement,
  archiveUri: string,
  scopeUri: string,
): string {
  switch (improvement.kind) {
    case "add-source":
      return formatCliCommand([
        `${archiveUri}/chapter`,
        "add",
        "--input",
        "source.txt",
      ]);
    case "sync-index":
      return formatCliCommand([`${archiveUri}/index`, "sync"]);
    case "build":
      return formatBuildCommand(
        scopeUri,
        improvement.task!,
        improvement.planning !== undefined,
      );
  }
}

function formatBuildCommand(
  scopeUri: string,
  task: NonNullable<InspectImprovement["task"]>,
  acceptCost: boolean,
): string {
  return formatCliCommand([
    "wikg://local/job",
    "add",
    "--input",
    scopeUri,
    "--task",
    task,
    ...(acceptCost ? ["--accept-cost"] : []),
  ]);
}

function formatArchiveInspectText(report: CLIInspectReport): string {
  return (
    [
      "Archive Inspect",
      `URI: ${report.uri}`,
      `Scope: ${report.scope.type === "archive" ? "archive" : report.uri}`,
      "",
      "Content",
      `Chapters: ${report.content.chapters.content} content / ${report.content.chapters.total} total`,
      `Planned chapters: ${report.content.chapters.planned}`,
      `Source words: ${report.content.sourceWords}`,
      `Summary words: ${report.content.summaryWords}`,
      "",
      "Query Readiness",
      `Status: ${report.query.ready ? "available" : "unavailable"}`,
      `Search artifacts: ${report.searchArtifacts.status}`,
      ...(report.searchArtifacts.ready
        ? []
        : [
            `Fix: ${report.searchArtifacts.fixCommand}`,
            `Resource: ${report.searchArtifacts.resource}`,
            `Help: ${report.searchArtifacts.helpCommand}`,
          ]),
      "",
      "Index Cache",
      `Status: ${report.localIndexCache.status === "missing-or-outdated" ? "missing or outdated" : report.localIndexCache.status}`,
      ...(report.localIndexCache.current
        ? []
        : [
            `Impact: ${report.localIndexCache.impact}`,
            ...(report.localIndexCache.fixCommand === undefined
              ? []
              : [`Fix: ${report.localIndexCache.fixCommand}`]),
            ...(report.localIndexCache.resource === undefined
              ? []
              : [`Resource: ${report.localIndexCache.resource}`]),
          ]),
      "",
      "Coverage",
      formatCoverageLine(
        "FTS Index Artifact",
        report.coverage.ftsIndexArtifact,
      ),
      formatCoverageLine(
        "Source Embedding Index Artifact",
        report.coverage.sourceEmbeddingIndexArtifact,
      ),
      formatCoverageLine(
        "Summary Embedding Index Artifact",
        report.coverage.summaryEmbeddingIndexArtifact,
      ),
      formatCoverageLine("Reading Graph", report.coverage.readingGraph),
      formatCoverageLine("Knowledge Graph", report.coverage.knowledgeGraph),
      formatCoverageLine("Summary Artifact", report.coverage.summary),
      `Summary note: ${report.help.summaryCoverage}`,
      ...(report.searchArtifacts.blockedChapters.length === 0
        ? []
        : [
            "Query blockers: these chapters have neither FTS nor source embedding index artifacts:",
            ...report.searchArtifacts.blockedChapters.map(
              (chapter) =>
                `- ${chapter.title === null ? "[untitled]" : chapter.title}: ${chapter.locatedUri}`,
            ),
          ]),
      "",
      "Retrieval Guidance",
      ...report.retrievalGuidance,
      "",
      "Improvements",
      ...(report.improvements.length === 0
        ? ["No immediate improvements recommended."]
        : [
            ...report.improvements.flatMap(formatInspectImprovement),
            "",
            ...formatInspectPerformanceHints(report.performanceHints),
            ...(report.performanceHints.length === 0 ? [] : [""]),
            `Readiness details: ${report.help.readiness}`,
          ]),
    ].join("\n") + "\n"
  );
}

function formatCoverageLine(label: string, coverage: InspectCoverage): string {
  if (coverage.totalChapters === 0 && coverage.totalWords === 0) {
    return `${label}: n/a, no source content`;
  }
  return `${label}: ${coverage.coveredChapters}/${coverage.totalChapters} chapters, ${coverage.coveredWords}/${coverage.totalWords} words, ${coverage.percent}`;
}

function formatInspectImprovement(
  improvement: CLIInspectImprovement,
): readonly string[] {
  return [
    `${improvement.title}:`,
    ...(improvement.missingChapters === undefined
      ? []
      : [
          `  Missing: ${improvement.missingChapters} chapters / ${improvement.missingWords} words`,
        ]),
    `  Recommendation: ${improvement.recommendation}`,
    ...(improvement.planning === undefined
      ? [`  Command: ${improvement.command}`]
      : [
          "  If completing this scope:",
          `    Command: ${improvement.command}`,
          `    Model: ${improvement.planning.model}`,
          `    Tokens: ${improvement.planning.tokens.input} input / ${improvement.planning.tokens.cacheableInput} cacheable input / ${improvement.planning.tokens.output} output`,
          `    Wait: ${formatGenerationPlanningDuration(improvement.planning.timeSeconds.min)}-${formatGenerationPlanningDuration(improvement.planning.timeSeconds.max)}`,
        ]),
  ];
}

function formatInspectPerformanceHints(
  hints: readonly CLIGenerationPerformanceHint[],
): readonly string[] {
  if (hints.length === 0) return [];
  return [
    "Performance hints:",
    ...hints.flatMap((hint) => [
      `  ${hint.message}`,
      `  Current ${hint.kind}: ${hint.current}; suggested: ${hint.recommended}.`,
      `  Command: ${hint.command}`,
    ]),
  ];
}
