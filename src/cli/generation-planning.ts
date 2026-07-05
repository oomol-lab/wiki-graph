import type { BuildJobTarget } from "../facade/index.js";

export interface GenerationConcurrency {
  readonly job: number;
  readonly request: number;
}

export interface GenerationPlanningCost {
  readonly model: string;
  readonly timeSeconds: {
    readonly max: number;
    readonly min: number;
  };
  readonly tokens: {
    readonly cacheableInput: number;
    readonly input: number;
    readonly output: number;
  };
}

export interface GenerationPerformanceHint {
  readonly command: string;
  readonly current: number;
  readonly kind: "job" | "request";
  readonly message: string;
  readonly recommended: number;
}

export function planGenerationTask(
  task: BuildJobTarget,
  words: number,
  chapters: number,
  concurrent: GenerationConcurrency,
  model: string,
): GenerationPlanningCost {
  const profile = getGenerationPlanningProfile(task);
  const calls = Math.max(chapters, Math.ceil(words / profile.wordsPerCall));
  const effectiveConcurrency = Math.max(
    1,
    task === "reading-graph" ? 1 : concurrent.request,
  );
  const callBatches = Math.ceil(calls / effectiveConcurrency);
  const wordSeconds = words * profile.secondsPerWord;

  return {
    model,
    timeSeconds: {
      max: Math.ceil(callBatches * profile.maxSecondsPerCall + wordSeconds),
      min: Math.ceil(callBatches * profile.minSecondsPerCall + wordSeconds),
    },
    tokens: {
      cacheableInput: Math.ceil(words * profile.cacheableInputTokenPerWord),
      input: Math.ceil(words * profile.inputTokenPerWord),
      output: Math.ceil(words * profile.outputTokenPerWord),
    },
  };
}

export function createGenerationPerformanceHints(input: {
  readonly chapters: number;
  readonly concurrent: GenerationConcurrency;
  readonly hasGenerationWork: boolean;
}): readonly GenerationPerformanceHint[] {
  if (!input.hasGenerationWork) {
    return [];
  }

  const hints: GenerationPerformanceHint[] = [];

  if (input.concurrent.request < 4) {
    hints.push({
      command: "wikigraph wikg://local/config/concurrent put request 6",
      current: input.concurrent.request,
      kind: "request",
      message:
        "LLM request concurrency is below 4. Use at least 4; 6-8 is usually faster when the provider allows it.",
      recommended: 6,
    });
  }

  if (input.concurrent.job < 4 && input.chapters > 1) {
    hints.push({
      command: "wikigraph wikg://local/config/concurrent put job 4",
      current: input.concurrent.job,
      kind: "job",
      message:
        "Multiple chapters need generation and job concurrency is below 4. Raising it lets chapter jobs run in parallel.",
      recommended: 4,
    });
  }

  return hints;
}

export function formatGenerationPlanningModel(
  llm: { readonly model?: string; readonly provider?: string } | undefined,
): string {
  if (llm?.model === undefined) {
    return "not configured";
  }

  return llm.provider === undefined
    ? llm.model
    : `${llm.provider}/${llm.model}`;
}

export function formatGenerationPlanningDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.round(minutes / 60)}h`;
}

function getGenerationPlanningProfile(task: BuildJobTarget): {
  readonly inputTokenPerWord: number;
  readonly cacheableInputTokenPerWord: number;
  readonly maxSecondsPerCall: number;
  readonly minSecondsPerCall: number;
  readonly outputTokenPerWord: number;
  readonly secondsPerWord: number;
  readonly wordsPerCall: number;
} {
  switch (task) {
    case "knowledge-graph":
      return {
        cacheableInputTokenPerWord: 60,
        inputTokenPerWord: 80,
        maxSecondsPerCall: 35,
        minSecondsPerCall: 15,
        outputTokenPerWord: 25,
        secondsPerWord: 0.02,
        wordsPerCall: 35,
      };
    case "reading-graph":
      return {
        cacheableInputTokenPerWord: 20,
        inputTokenPerWord: 25,
        maxSecondsPerCall: 45,
        minSecondsPerCall: 15,
        outputTokenPerWord: 4,
        secondsPerWord: 0.01,
        wordsPerCall: 160,
      };
    case "reading-summary":
      return {
        cacheableInputTokenPerWord: 45,
        inputTokenPerWord: 55,
        maxSecondsPerCall: 25,
        minSecondsPerCall: 10,
        outputTokenPerWord: 4,
        secondsPerWord: 0.01,
        wordsPerCall: 110,
      };
  }
}
