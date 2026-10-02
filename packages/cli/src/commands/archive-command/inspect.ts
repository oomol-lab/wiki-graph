import type {
  WikiGraphArchiveInspectCoverage,
  WikiGraphArchiveInspectImprovement,
  WikiGraphArchiveInspectReport,
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

interface CLIInspectImprovement extends WikiGraphArchiveInspectImprovement {
  readonly command: string;
}

interface CLIInspectReport extends Omit<
  WikiGraphArchiveInspectReport,
  "archiveUri" | "improvements" | "performanceHints" | "summaryCoverageNote"
> {
  readonly localIndexCache: WikiGraphArchiveInspectReport["localIndexCache"] & {
    readonly fixCommand?: string;
  };
  readonly searchArtifacts: WikiGraphArchiveInspectReport["searchArtifacts"] & {
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
    await archive.inspect({
      ...(args.chapterId === undefined ? {} : { chapterId: args.chapterId }),
    }),
  );

  await writeTextToStdout(
    args.json === true
      ? formatCLIJSON(report)
      : formatArchiveInspectText(report),
  );
}

function toCLIInspectReport(
  report: WikiGraphArchiveInspectReport,
): CLIInspectReport {
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
  improvement: WikiGraphArchiveInspectImprovement,
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
  task: NonNullable<WikiGraphArchiveInspectImprovement["task"]>,
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

function formatCoverageLine(
  label: string,
  coverage: WikiGraphArchiveInspectCoverage,
): string {
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
