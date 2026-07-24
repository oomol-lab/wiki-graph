import {
  formatWikiGraphCommandUri,
  isArchiveSearchIndexCurrent,
  listChapters,
  readArchiveIndexSettings,
  type ChapterEntry,
  type ReadonlyDocument,
} from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../args/index.js";
import { loadCLIConfig } from "../../runtime/config.js";
import {
  createGenerationPerformanceHints,
  DEFAULT_GENERATION_JOB_CONCURRENCY,
  DEFAULT_GENERATION_REQUEST_CONCURRENCY,
  formatGenerationPlanningDuration,
  formatGenerationPlanningModel,
  planGenerationTask,
  type GenerationPerformanceHint,
  type GenerationPlanningCost,
} from "../../runtime/index.js";
import {
  formatCLIJSON,
  formatCliCommand,
  writeTextToStdout,
} from "../../support/index.js";

interface InspectChapter extends ChapterEntry {
  readonly knowledgeGraphReady: boolean;
  readonly readingGraphReady: boolean;
  readonly summaryReady: boolean;
}

interface InspectImprovement {
  readonly command: string;
  readonly missingChapters?: number;
  readonly missingWords?: number;
  readonly planning?: GenerationPlanningCost;
  readonly recommendation: string;
  readonly title: string;
}

interface InspectCoverage {
  readonly coveredChapters: number;
  readonly coveredWords: number;
  readonly percent: string;
  readonly totalChapters: number;
  readonly totalWords: number;
}

interface InspectReport {
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
  readonly index: {
    readonly current: boolean;
    readonly fixCommand?: string;
    readonly impact?: string;
    readonly querySupport: boolean;
    readonly resource?: string;
    readonly status: "current" | "missing-or-outdated";
    readonly storage: "archive" | "cache";
  };
  readonly coverage: {
    readonly knowledgeGraph: InspectCoverage;
    readonly readingGraph: InspectCoverage;
    readonly summary: InspectCoverage;
  };
  readonly retrievalGuidance: readonly string[];
  readonly improvements: readonly InspectImprovement[];
  readonly performanceHints: readonly GenerationPerformanceHint[];
  readonly help: {
    readonly readiness: string;
  };
}

export async function writeArchiveInspectReport(
  document: ReadonlyDocument,
  args: CLIArchiveArguments,
): Promise<void> {
  const report = await createArchiveInspectReport(document, args);

  if (args.json === true) {
    await writeTextToStdout(formatCLIJSON(report));
    return;
  }

  await writeTextToStdout(formatArchiveInspectText(report));
}

async function createArchiveInspectReport(
  document: ReadonlyDocument,
  args: CLIArchiveArguments,
): Promise<InspectReport> {
  const archiveUri = formatArchiveInspectCommandUri(args.archivePath);
  const scopeUri =
    args.chapterId === undefined
      ? archiveUri
      : `${archiveUri}/chapter/${args.chapterId}`;
  const [chapters, summaryWords, ftsCurrent, indexSettings, config] =
    await Promise.all([
      readInspectChapters(document, args.chapterId),
      readSummaryWords(document, args.chapterId),
      isArchiveSearchIndexCurrent(document),
      readArchiveIndexSettings(document),
      loadCLIConfig(),
    ]);
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
  const improvements = createInspectImprovements({
    archiveUri,
    concurrent,
    contentChapters,
    ftsCurrent,
    planningModel,
    scopeUri,
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
    hasGenerationWork: improvements.some(
      (improvement) => improvement.planning !== undefined,
    ),
  });

  return {
    uri: scopeUri,
    scope:
      args.chapterId === undefined
        ? { type: "archive" }
        : { chapterId: args.chapterId, type: "chapter" },
    content: {
      chapters: {
        content: contentChapters.length,
        planned: chapters.length - contentChapters.length,
        total: chapters.length,
      },
      sourceWords,
      summaryWords,
    },
    index: {
      current: ftsCurrent,
      ...(ftsCurrent
        ? {}
        : {
            fixCommand: formatCliCommand([`${archiveUri}/index`, "enable"]),
            impact:
              "--query, related --query, and evidence --query are unavailable.",
            resource: "local CPU/disk time only; no LLM tokens.",
          }),
      querySupport: ftsCurrent,
      status: ftsCurrent ? "current" : "missing-or-outdated",
      storage: indexSettings.ftsEmbedded ? "archive" : "cache",
    },
    coverage: {
      knowledgeGraph: createInspectCoverage(
        knowledgeGraphCovered,
        contentChapters,
      ),
      readingGraph: createInspectCoverage(readingGraphCovered, contentChapters),
      summary: createInspectCoverage(summaryCovered, contentChapters),
    },
    retrievalGuidance: formatRetrievalGuidance({
      ftsCurrent,
      knowledgeGraphCovered,
      readingGraphCovered,
      contentChapters,
      sourceWords,
    }),
    improvements,
    performanceHints,
    help: { readiness: "wg help readiness" },
  };
}

function formatArchiveInspectCommandUri(archivePath: string): string {
  if (archivePath.startsWith("wikg://lib/")) {
    return archivePath;
  }

  return formatWikiGraphCommandUri(archivePath);
}

function formatArchiveInspectText(report: InspectReport): string {
  return (
    [
      "Archive Inspect",
      `URI: ${report.uri}`,
      `Scope: ${report.scope.type === "archive" ? "archive" : `chapter ${report.scope.chapterId}`}`,
      "",
      "Content",
      `Chapters: ${report.content.chapters.content} content / ${report.content.chapters.total} total`,
      `Planned chapters: ${report.content.chapters.planned}`,
      `Source words: ${report.content.sourceWords}`,
      `Summary words: ${report.content.summaryWords}`,
      "",
      "FTS Index",
      `Status: ${report.index.current ? "current" : "missing or outdated"}`,
      `Storage: ${report.index.storage === "archive" ? "embedded in archive" : "local cache"}`,
      `Query support: ${report.index.querySupport ? "available" : "unavailable"}`,
      ...(report.index.current
        ? []
        : [
            `Impact: ${report.index.impact}`,
            `Fix: ${report.index.fixCommand}`,
            `Resource: ${report.index.resource}`,
          ]),
      "",
      "Coverage",
      formatCoverageLine("Reading Graph", report.coverage.readingGraph),
      formatCoverageLine("Knowledge Graph", report.coverage.knowledgeGraph),
      formatCoverageLine("Summary", report.coverage.summary),
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

function createInspectCoverage(
  covered: readonly InspectChapter[],
  total: readonly InspectChapter[],
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

function formatCoverageLine(label: string, coverage: InspectCoverage): string {
  if (coverage.totalChapters === 0 && coverage.totalWords === 0) {
    return `${label}: n/a, no source content`;
  }

  return `${label}: ${coverage.coveredChapters}/${coverage.totalChapters} chapters, ${coverage.coveredWords}/${coverage.totalWords} words, ${coverage.percent}`;
}

function formatRetrievalGuidance(input: {
  readonly contentChapters: readonly InspectChapter[];
  readonly ftsCurrent: boolean;
  readonly knowledgeGraphCovered: readonly InspectChapter[];
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
    `Query support: ${input.ftsCurrent ? "available" : "unavailable until the searchable index is enabled"}.`,
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
  readonly archiveUri: string;
  readonly concurrent: { readonly job: number; readonly request: number };
  readonly contentChapters: readonly InspectChapter[];
  readonly ftsCurrent: boolean;
  readonly knowledgeGraphCovered: readonly InspectChapter[];
  readonly planningModel: string;
  readonly readingGraphCovered: readonly InspectChapter[];
  readonly scopeUri: string;
  readonly summaryCovered: readonly InspectChapter[];
}): readonly InspectImprovement[] {
  const improvements: InspectImprovement[] = [];

  if (!input.ftsCurrent) {
    improvements.push({
      command: formatCliCommand([`${input.archiveUri}/index`, "enable"]),
      recommendation:
        "Enable the searchable FTS index so --query filtering is available for scopes, related results, and evidence.",
      title: "Enable searchable index",
    });
  }

  if (input.contentChapters.length === 0) {
    improvements.push({
      command: formatCliCommand([
        `${input.archiveUri}/chapter`,
        "add",
        "--input",
        "source.txt",
      ]),
      recommendation:
        "No source content is available yet; add or import source text before graph or summary generation.",
      title: "Add source content",
    });
    return improvements;
  }

  improvements.push(
    ...createGraphImprovement({
      concurrent: input.concurrent,
      covered: input.readingGraphCovered,
      planningModel: input.planningModel,
      scopeUri: input.scopeUri,
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
      scopeUri: input.scopeUri,
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
      scopeUri: input.scopeUri,
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
  readonly scopeUri: string;
  readonly task: "knowledge-graph" | "reading-graph" | "reading-summary";
  readonly title: string;
  readonly total: readonly InspectChapter[];
}): readonly InspectImprovement[] {
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
      command: formatCliCommand([
        "wikg://local/job",
        "add",
        "--input",
        input.scopeUri,
        "--task",
        input.task,
        "--accept-cost",
      ]),
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

function formatInspectImprovement(
  improvement: InspectImprovement,
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
  hints: readonly GenerationPerformanceHint[],
): readonly string[] {
  if (hints.length === 0) {
    return [];
  }

  return [
    "Performance hints:",
    ...hints.flatMap((hint) => [
      `  ${hint.message}`,
      `  Current ${hint.kind}: ${hint.current}; suggested: ${hint.recommended}.`,
      `  Command: ${hint.command}`,
    ]),
  ];
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
