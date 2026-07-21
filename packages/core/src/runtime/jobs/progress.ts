import type {
  BuildJob,
  BuildJobEvent,
  BuildJobProgressCounter,
  BuildJobProgressPhase,
  BuildJobProgressReporter,
  BuildJobProgressUnit,
  BuildJobTarget,
  BuildJobTokenUsage,
} from "./types.js";

export interface BuildJobProgressAccumulatorActions {
  appendBuildJobEvent(job: BuildJob, event: BuildJobEvent): Promise<void>;
  markBuildJobStep(jobId: string, step: BuildJobTarget): Promise<void>;
  readBuildJobForStopCheck(jobId: string): Promise<BuildJob>;
}

export class BuildJobProgressAccumulator implements BuildJobProgressReporter {
  readonly #job: BuildJob;
  readonly #ownerId: string;
  readonly #actions: BuildJobProgressAccumulatorActions;
  readonly #outputCharactersPerToken = 4;
  readonly #refreshIntervalMs = 5_000;
  #graphWords = 0;
  #lastSnapshotAt = 0;
  #outputCharacters = 0;
  #phase: BuildJobProgressPhase | undefined;
  readonly #phaseCounters = new Map<string, BuildJobProgressCounter>();
  #step: BuildJobTarget | undefined;
  #tokenUsage: BuildJobTokenUsage = {};
  #readingSummaryWords = 0;
  #stopCheckQueue: Promise<void> = Promise.resolve();
  #totalGraphWords = 0;
  #totalReadingSummaryWords = 0;
  #writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    job: BuildJob,
    ownerId: string,
    actions: BuildJobProgressAccumulatorActions,
  ) {
    this.#job = job;
    this.#ownerId = ownerId;
    this.#actions = actions;
  }

  public async addOutputCharacters(characters: number): Promise<void> {
    await this.#enqueue(async () => {
      await this.throwIfStopped();
      this.#outputCharacters += characters;
      await this.#snapshot();
    });
  }

  public async addTokenUsage(usage: BuildJobTokenUsage): Promise<void> {
    await this.#enqueue(async () => {
      await this.throwIfStopped();
      this.#tokenUsage = {
        ...formatOptionalTokenUsage(
          "cacheReadTokens",
          addOptionalNumbers(
            this.#tokenUsage.cacheReadTokens,
            usage.cacheReadTokens,
          ),
        ),
        ...formatOptionalTokenUsage(
          "inputTokens",
          addOptionalNumbers(this.#tokenUsage.inputTokens, usage.inputTokens),
        ),
        ...formatOptionalTokenUsage(
          "outputTokens",
          addOptionalNumbers(this.#tokenUsage.outputTokens, usage.outputTokens),
        ),
      };
      await this.#snapshot(true);
    });
  }

  public async setTotals(input: {
    readonly totalGraphWords?: number;
    readonly totalReadingSummaryWords?: number;
  }): Promise<void> {
    await this.#enqueue(async () => {
      await this.throwIfStopped();
      this.#totalGraphWords = input.totalGraphWords ?? this.#totalGraphWords;
      this.#totalReadingSummaryWords =
        input.totalReadingSummaryWords ?? this.#totalReadingSummaryWords;
      await this.#snapshot(true);
    });
  }

  public async stepStarted(step: BuildJobTarget): Promise<void> {
    await this.#enqueue(async () => {
      await this.throwIfStopped();
      this.#step = step;
      this.#phase = undefined;
      this.#phaseCounters.clear();
      await this.#actions.markBuildJobStep(this.#job.jobId, step);
      await this.#actions.appendBuildJobEvent(this.#job, {
        at: Date.now(),
        jobId: this.#job.jobId,
        seq: 0,
        step,
        type: "step_started",
      });
      await this.#snapshot(true);
    });
  }

  public async stepCompleted(step: BuildJobTarget): Promise<void> {
    await this.#enqueue(async () => {
      await this.throwIfStopped();
      this.#step = step;
      this.#phase = undefined;
      this.#phaseCounters.clear();
      await this.#actions.appendBuildJobEvent(this.#job, {
        at: Date.now(),
        jobId: this.#job.jobId,
        seq: 0,
        step,
        type: "step_completed",
      });
      await this.#snapshot(true);
    });
  }

  public async updateWords(input: {
    readonly graphWords?: number;
    readonly readingSummaryWords?: number;
  }): Promise<void> {
    await this.#enqueue(async () => {
      await this.throwIfStopped();
      this.#graphWords =
        input.graphWords === undefined
          ? this.#graphWords
          : clampProgressWords(input.graphWords, this.#totalGraphWords);
      this.#readingSummaryWords =
        input.readingSummaryWords === undefined
          ? this.#readingSummaryWords
          : clampProgressWords(
              input.readingSummaryWords,
              this.#totalReadingSummaryWords,
            );
      await this.#snapshot();
    });
  }

  public async updatePhase(input: {
    readonly done: number;
    readonly force?: boolean;
    readonly phase: BuildJobProgressPhase;
    readonly phaseDetail?: string;
    readonly total: number;
    readonly unit: BuildJobProgressUnit;
  }): Promise<void> {
    await this.#enqueue(async () => {
      await this.throwIfStopped();
      if (this.#phase !== input.phase) {
        this.#phaseCounters.clear();
      }
      this.#phase = input.phase;
      this.#phaseCounters.set(formatProgressCounterKey(input), {
        done: clampProgressWords(input.done, input.total),
        name: formatProgressCounterName(input),
        total: Math.max(0, input.total),
        unit: input.unit,
      });
      await this.#snapshot(input.force ?? true);
    });
  }

  public async throwIfStopped(): Promise<void> {
    const queued = this.#stopCheckQueue.then(async () => {
      const job = await this.#actions.readBuildJobForStopCheck(this.#job.jobId);

      if (job.state === "running" && job.ownerId === this.#ownerId) {
        return;
      }

      throw new BuildJobStoppedError(
        `Job ${this.#job.jobId} is ${job.state}. Stop current worker execution.`,
      );
    });

    this.#stopCheckQueue = queued.catch(() => undefined);
    await queued;
  }

  async #enqueue(operation: () => Promise<void>): Promise<void> {
    const queued = this.#writeQueue.then(operation, operation);

    this.#writeQueue = queued.catch(() => undefined);
    await queued;
  }

  async #snapshot(force = false): Promise<void> {
    const now = Date.now();

    if (!force && now - this.#lastSnapshotAt < this.#refreshIntervalMs) {
      return;
    }

    this.#lastSnapshotAt = now;
    const tokens = this.#formatTokenUsage();

    await this.#actions.appendBuildJobEvent(this.#job, {
      at: now,
      counters: this.#createCounters(),
      jobId: this.#job.jobId,
      ...(this.#phase === undefined ? {} : { phase: this.#phase }),
      seq: 0,
      ...(this.#step === undefined ? {} : { step: this.#step }),
      ...(tokens === undefined ? {} : { tokens }),
      type: "status_snapshot",
    });
  }

  #createCounters(): readonly BuildJobProgressCounter[] {
    const wordCounter = this.#createWordCounter();
    return [
      ...(wordCounter === undefined ? [] : [wordCounter]),
      ...this.#phaseCounters.values(),
    ];
  }

  #createWordCounter(): BuildJobProgressCounter | undefined {
    switch (this.#step) {
      case "reading-graph":
        return this.#totalGraphWords <= 0
          ? undefined
          : {
              done: this.#graphWords,
              name: "words",
              total: this.#totalGraphWords,
              unit: "word",
            };
      case "reading-summary":
        return this.#totalReadingSummaryWords <= 0
          ? undefined
          : {
              done: this.#readingSummaryWords,
              name: "words",
              total: this.#totalReadingSummaryWords,
              unit: "word",
            };
      case undefined:
        return undefined;
    }
  }

  #formatTokenUsage(): BuildJobTokenUsage | undefined {
    const outputTokens =
      this.#tokenUsage.outputTokens ??
      (this.#outputCharacters === 0
        ? undefined
        : Math.floor(this.#outputCharacters / this.#outputCharactersPerToken));
    const usage = {
      ...(this.#tokenUsage.cacheReadTokens === undefined
        ? {}
        : { cacheReadTokens: this.#tokenUsage.cacheReadTokens }),
      ...(this.#tokenUsage.inputTokens === undefined
        ? {}
        : { inputTokens: this.#tokenUsage.inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    };

    return Object.keys(usage).length === 0 ? undefined : usage;
  }
}

function formatOptionalTokenUsage(
  key: keyof BuildJobTokenUsage,
  value: number | undefined,
): BuildJobTokenUsage {
  return value === undefined ? {} : { [key]: value };
}

function addOptionalNumbers(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }

  return (left ?? 0) + (right ?? 0);
}

function formatProgressCounterKey(input: {
  readonly phaseDetail?: string;
  readonly unit: BuildJobProgressUnit;
}): string {
  return input.phaseDetail ?? input.unit;
}

function formatProgressCounterName(input: {
  readonly phaseDetail?: string;
  readonly unit: BuildJobProgressUnit;
}): string {
  if (input.phaseDetail !== undefined) {
    return input.phaseDetail;
  }

  switch (input.unit) {
    case "candidate":
      return "candidates";
    case "char":
      return "chars";
    case "item":
      return "items";
    case "page":
      return "page";
    case "qid":
      return "qids";
    case "record":
      return "records";
    case "sentence":
      return "sentences";
    case "window":
      return "windows";
  }
}

export class BuildJobStoppedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BuildJobStoppedError";
  }
}

function clampProgressWords(words: number, totalWords: number): number {
  if (totalWords <= 0) {
    return Math.max(0, words);
  }

  return Math.min(totalWords, Math.max(0, words));
}
