import {
  getBuildJob,
  readBuildJobEvents,
  type BuildJobEvent,
  type BuildJobProgressCounter,
  type BuildJobState,
  type BuildJobTarget,
} from "wiki-graph-core";

import {
  ProgressOutputWriter,
  type ProgressCounter,
  type ProgressMetricGroup,
} from "../../runtime/index.js";

const TERMINAL_STATES = new Set<BuildJobState>([
  "succeeded",
  "failed",
  "canceled",
]);
const PROGRESS_OUTPUT_INTERVAL_MS = 6_000;

export async function watchBuildJob(
  jobId: string,
  options: {
    readonly from: "beginning" | "now";
    readonly jsonl: boolean;
  },
): Promise<void> {
  let seenSeq = 0;
  const writer = new ProgressOutputWriter({
    jsonl: options.jsonl,
    throttleMs: PROGRESS_OUTPUT_INTERVAL_MS,
  });

  if (options.from === "now") {
    const job = await getBuildJob(jobId);
    const events = await readBuildJobEvents(job);

    seenSeq = events.at(-1)?.seq ?? 0;
  }

  while (true) {
    const job = await getBuildJob(jobId);
    const events = (await readBuildJobEvents(job)).filter(
      (event) => event.seq > seenSeq,
    );

    for (const event of events) {
      seenSeq = Math.max(seenSeq, event.seq);
      await writer.write(formatWatchOutputEvent(event));
    }

    if (TERMINAL_STATES.has(job.state)) {
      return;
    }

    await delay(1_000);
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

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
