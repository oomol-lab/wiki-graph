import type { BuildJobTarget, ChapterEntry } from "wiki-graph-core";

import type { CLIConfig } from "../../config.js";
import {
  createGenerationPerformanceHints,
  DEFAULT_GENERATION_JOB_CONCURRENCY,
  DEFAULT_GENERATION_REQUEST_CONCURRENCY,
  formatGenerationPlanningDuration,
  formatGenerationPlanningModel,
  planGenerationTask,
  type GenerationConcurrency,
  type GenerationPerformanceHint,
  type GenerationPlanningCost,
} from "../../runtime/index.js";

export interface QueueAddEstimate {
  readonly chapters: number;
  readonly concurrent: GenerationConcurrency;
  readonly includesPrerequisites: boolean;
  readonly performanceHints: readonly GenerationPerformanceHint[];
  readonly planning: GenerationPlanningCost;
  readonly steps: readonly QueueAddEstimateStep[];
  readonly target: BuildJobTarget;
  readonly words: number;
}

interface QueueAddEstimateStep {
  readonly chapters: number;
  readonly planning: GenerationPlanningCost;
  readonly prerequisite: boolean;
  readonly task: BuildJobTarget;
  readonly words: number;
}

export function createQueueAddEstimate(input: {
  readonly chapters: readonly Pick<ChapterEntry, "stage" | "words">[];
  readonly config: CLIConfig;
  readonly target: BuildJobTarget;
}): QueueAddEstimate {
  const concurrent = {
    job: input.config.concurrent?.job ?? DEFAULT_GENERATION_JOB_CONCURRENCY,
    request:
      input.config.concurrent?.request ??
      DEFAULT_GENERATION_REQUEST_CONCURRENCY,
  };
  const words = input.chapters.reduce(
    (total, chapter) => total + chapter.words,
    0,
  );
  const model = formatGenerationPlanningModel(input.config.llm);
  const steps = createQueueAddEstimateSteps({
    chapters: input.chapters,
    concurrent,
    model,
    target: input.target,
  });
  const workChapters = Math.max(0, ...steps.map((step) => step.chapters));

  return {
    chapters: input.chapters.length,
    concurrent,
    includesPrerequisites: steps.some((step) => step.prerequisite),
    performanceHints: createGenerationPerformanceHints({
      chapters: workChapters,
      concurrent,
      hasGenerationWork: steps.length > 0,
    }),
    planning: sumGenerationPlanningCosts(model, steps),
    steps,
    target: input.target,
    words,
  };
}

function createQueueAddEstimateSteps(input: {
  readonly chapters: readonly Pick<ChapterEntry, "stage" | "words">[];
  readonly concurrent: GenerationConcurrency;
  readonly model: string;
  readonly target: BuildJobTarget;
}): readonly QueueAddEstimateStep[] {
  switch (input.target) {
    case "knowledge-graph":
      return [
        createQueueAddEstimateStep({
          chapters: input.chapters,
          concurrent: input.concurrent,
          model: input.model,
          prerequisite: false,
          task: "knowledge-graph",
        }),
      ].filter((step) => step.chapters > 0);
    case "reading-graph":
      return [
        createQueueAddEstimateStep({
          chapters: input.chapters.filter(
            (chapter) => chapter.stage === "sourced",
          ),
          concurrent: input.concurrent,
          model: input.model,
          prerequisite: false,
          task: "reading-graph",
        }),
      ].filter((step) => step.chapters > 0);
    case "reading-summary": {
      const graphChapters = input.chapters.filter(
        (chapter) => chapter.stage === "sourced",
      );
      const summaryChapters = input.chapters.filter(
        (chapter) => chapter.stage === "sourced" || chapter.stage === "graphed",
      );

      return [
        createQueueAddEstimateStep({
          chapters: graphChapters,
          concurrent: input.concurrent,
          model: input.model,
          prerequisite: true,
          task: "reading-graph",
        }),
        createQueueAddEstimateStep({
          chapters: summaryChapters,
          concurrent: input.concurrent,
          model: input.model,
          prerequisite: false,
          task: "reading-summary",
        }),
      ].filter((step) => step.chapters > 0);
    }
  }
}

function createQueueAddEstimateStep(input: {
  readonly chapters: readonly Pick<ChapterEntry, "words">[];
  readonly concurrent: GenerationConcurrency;
  readonly model: string;
  readonly prerequisite: boolean;
  readonly task: BuildJobTarget;
}): QueueAddEstimateStep {
  const words = input.chapters.reduce(
    (total, chapter) => total + chapter.words,
    0,
  );

  return {
    chapters: input.chapters.length,
    planning: planGenerationTask(
      input.task,
      words,
      input.chapters.length,
      input.concurrent,
      input.model,
    ),
    prerequisite: input.prerequisite,
    task: input.task,
    words,
  };
}

function sumGenerationPlanningCosts(
  model: string,
  steps: readonly QueueAddEstimateStep[],
): GenerationPlanningCost {
  return {
    model,
    timeSeconds: {
      max: steps.reduce(
        (total, step) => total + step.planning.timeSeconds.max,
        0,
      ),
      min: steps.reduce(
        (total, step) => total + step.planning.timeSeconds.min,
        0,
      ),
    },
    tokens: {
      cacheableInput: steps.reduce(
        (total, step) => total + step.planning.tokens.cacheableInput,
        0,
      ),
      input: steps.reduce(
        (total, step) => total + step.planning.tokens.input,
        0,
      ),
      output: steps.reduce(
        (total, step) => total + step.planning.tokens.output,
        0,
      ),
    },
  };
}

export function formatQueueAddEstimateJSON(
  estimate: QueueAddEstimate,
): unknown {
  return {
    chapters: estimate.chapters,
    concurrent: estimate.concurrent,
    includesPrerequisites: estimate.includesPrerequisites,
    performanceHints: estimate.performanceHints,
    steps: estimate.steps.map((step) => ({
      chapters: step.chapters,
      prerequisite: step.prerequisite,
      task: step.task,
      tokens: step.planning.tokens,
      waitSeconds: step.planning.timeSeconds,
      words: step.words,
    })),
    target: estimate.target,
    tokens: estimate.planning.tokens,
    waitSeconds: estimate.planning.timeSeconds,
    words: estimate.words,
    model: estimate.planning.model,
  };
}

export function formatQueueAddEstimateLines(
  estimate: QueueAddEstimate,
): readonly string[] {
  return [
    "Estimate:",
    `  Work: ${estimate.target} over ${estimate.chapters} chapter${estimate.chapters === 1 ? "" : "s"} / ${estimate.words} words`,
    ...(estimate.includesPrerequisites
      ? ["  Includes prerequisite Reading Graph work where missing."]
      : []),
    `  Model: ${estimate.planning.model}`,
    `  Tokens: ${estimate.planning.tokens.input} input / ${estimate.planning.tokens.cacheableInput} cacheable input / ${estimate.planning.tokens.output} output`,
    `  Wait: ${formatGenerationPlanningDuration(estimate.planning.timeSeconds.min)}-${formatGenerationPlanningDuration(estimate.planning.timeSeconds.max)}`,
    `  Current concurrency: job=${estimate.concurrent.job} request=${estimate.concurrent.request}`,
    ...formatQueuePerformanceHintLines(estimate.performanceHints),
  ];
}

function formatQueuePerformanceHintLines(
  hints: readonly GenerationPerformanceHint[],
): readonly string[] {
  if (hints.length === 0) {
    return [];
  }

  return [
    "Performance hints:",
    ...hints.flatMap((hint) => [
      `  ${hint.message}`,
      `  Command: ${hint.command}`,
    ]),
  ];
}
