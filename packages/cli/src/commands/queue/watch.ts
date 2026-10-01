import {
  type BuildJobEvent,
  type BuildJobProgressCounter,
  type BuildJobTarget,
} from "wiki-graph-sdk";

import {
  ProgressOutputWriter,
  type ProgressCounter,
  type ProgressMetricGroup,
} from "../../runtime/index.js";
import { getCLISignal, getWikiGraphSDK } from "../../runtime/context.js";

const PROGRESS_OUTPUT_INTERVAL_MS = 6_000;

export async function watchBuildJob(
  jobId: string,
  options: {
    readonly from: "beginning" | "now";
    readonly jsonl: boolean;
  },
): Promise<void> {
  const writer = new ProgressOutputWriter({
    jsonl: options.jsonl,
    throttleMs: PROGRESS_OUTPUT_INTERVAL_MS,
  });

  const job = await getWikiGraphSDK().jobs.get(jobId);
  const signal = getCLISignal();
  for await (const event of job.events({
    from: options.from,
    ...(signal === undefined ? {} : { signal }),
  })) {
    await writer.write(formatWatchOutputEvent(event));
  }
}

function formatWatchOutputEvent(event: BuildJobEvent) {
  switch (event.type) {
    case "status_snapshot": {
      const tokenMetrics = formatProgressTokenMetrics(event.tokens);
      return {
        counters: event.counters.map(formatProgressCounter),
        json: event,
        kind: "status" as const,
        ...(tokenMetrics === undefined ? {} : { metricGroups: [tokenMetrics] }),
        phase: event.phase ?? formatFallbackStatusPhase(event.step),
      };
    }
    case "target_changed":
      return {
        json: event,
        kind: "lifecycle" as const,
        text: `target ${event.from} -> ${event.to}`,
      };
    case "step_started":
      return {
        json: event,
        kind: "lifecycle" as const,
        text: `${event.step} started\nsteps: ${formatStepPlan(event.step)}`,
      };
    case "step_completed":
      return {
        json: event,
        kind: "lifecycle" as const,
        text: `${event.step} completed`,
      };
    case "created":
      return {
        json: event,
        kind: "lifecycle" as const,
        text: "created",
      };
    default:
      return {
        json: event,
        kind: "lifecycle" as const,
        text: event.type,
      };
  }
}

function formatFallbackStatusPhase(step: BuildJobTarget | undefined): string {
  switch (step) {
    case "reading-graph":
      return "extracting";
    case "reading-summary":
      return "summarizing";
    case "knowledge-graph":
      return "knowledge-graph";
    case undefined:
      return "status";
    default:
      return "status";
  }
}

function formatStepPlan(step: string): string {
  switch (step) {
    case "knowledge-graph":
      return "matching -> screening -> enrichment -> grounding -> relation-discovery -> committing";
    case "reading-summary":
      return "reading-graph -> summarizing -> committing";
    case "reading-graph":
      return "extracting -> committing";
    default:
      return step;
  }
}

function formatProgressCounter(
  counter: BuildJobProgressCounter,
): ProgressCounter {
  return {
    done: counter.done,
    name: counter.name,
    total: counter.total,
    unit: formatProgressUnit(counter.unit),
  };
}

function formatProgressUnit(unit: string): string {
  switch (unit) {
    case "candidate":
      return "candidates";
    case "char":
      return "chars";
    case "item":
      return "items";
    case "page":
      return "pages";
    case "qid":
      return "qids";
    case "record":
      return "records";
    case "sentence":
      return "sentences";
    case "word":
      return "words";
    case "window":
      return "windows";
    default:
      return unit;
  }
}

function formatProgressTokenMetrics(
  tokens: Extract<
    BuildJobEvent,
    { readonly type: "status_snapshot" }
  >["tokens"],
): ProgressMetricGroup | undefined {
  if (tokens === undefined) {
    return undefined;
  }

  const metrics = [
    ...(tokens.inputTokens === undefined
      ? []
      : [{ name: "input", value: tokens.inputTokens }]),
    ...(tokens.cacheReadTokens === undefined
      ? []
      : [{ name: "cache", value: tokens.cacheReadTokens }]),
    ...(tokens.outputTokens === undefined
      ? []
      : [{ name: "output", value: tokens.outputTokens }]),
  ];

  return metrics.length === 0 ? undefined : { metrics, name: "tokens" };
}
