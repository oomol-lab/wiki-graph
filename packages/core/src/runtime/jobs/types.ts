export const BUILD_JOB_STATES = [
  "queued",
  "running",
  "canceling",
  "paused",
  "succeeded",
  "failed",
  "canceled",
] as const;

export type BuildJobState = (typeof BUILD_JOB_STATES)[number];
export type BuildJobTarget =
  | "knowledge-graph"
  | "reading-graph"
  | "reading-summary";
export type BuildJobProgressPhase =
  | "committing"
  | "enrichment"
  | "grounding"
  | "matching"
  | "narrowing"
  | "relation-discovery"
  | "screening";
export type BuildJobProgressUnit =
  | "candidate"
  | "char"
  | "item"
  | "page"
  | "qid"
  | "sentence"
  | "window"
  | "record";

export interface BuildJobProgressCounter {
  readonly done: number;
  readonly name: string;
  readonly total: number;
  readonly unit: BuildJobProgressUnit | "word";
}

export interface BuildJobTokenUsage {
  readonly cacheReadTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface BuildJob {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly cachePath: string;
  readonly chapterId: number;
  readonly createdAt: number;
  readonly currentStep?: BuildJobTarget;
  readonly errorJSON?: string;
  readonly eventsPath: string;
  readonly finishedAt?: number;
  readonly jobId: string;
  readonly inputRevision?: number;
  readonly logPath: string;
  readonly llmJSON?: string;
  readonly ownerId?: string;
  readonly ownerPid?: number;
  readonly prompt?: string;
  readonly queueRank: number;
  readonly state: BuildJobState;
  readonly readingSummaryStartedAt?: number;
  readonly target: BuildJobTarget;
  readonly updatedAt: number;
  readonly workspacePath: string;
}

export type BuildJobEvent =
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly state: BuildJobState;
      readonly type: "created" | "paused" | "resumed" | "boosted" | "canceling";
    }
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly from: BuildJobTarget;
      readonly to: BuildJobTarget;
      readonly type: "target_changed";
    }
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly state: "running";
      readonly type: "started";
    }
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly state: "queued";
      readonly type: "requeued";
    }
  | {
      readonly at: number;
      readonly jobId: string;
      readonly seq: number;
      readonly step: BuildJobTarget;
      readonly type: "step_started" | "step_completed";
    }
  | {
      readonly at: number;
      readonly counters: readonly BuildJobProgressCounter[];
      readonly jobId: string;
      readonly phase?: BuildJobProgressPhase;
      readonly seq: number;
      readonly step?: BuildJobTarget;
      readonly tokens?: BuildJobTokenUsage;
      readonly type: "status_snapshot";
    }
  | {
      readonly at: number;
      readonly error?: unknown;
      readonly jobId: string;
      readonly seq: number;
      readonly state: "failed" | "canceled" | "succeeded";
      readonly type: "failed" | "canceled" | "succeeded";
    };

export interface AddBuildJobOptions {
  readonly archivePath: string;
  readonly boost?: boolean;
  readonly chapterId: number;
  readonly jobId?: string;
  readonly llmJSON?: string;
  readonly prompt?: string;
  readonly target: BuildJobTarget;
}

export interface BuildJobListOptions {
  readonly activeOnly?: boolean;
  readonly all?: boolean;
  readonly archivePath?: string;
}

export interface BuildJobWorkerOptions {
  readonly concurrency: number;
  readonly executeJob: (
    job: BuildJob,
    reporter: BuildJobProgressReporter,
    context: BuildJobExecutionContext,
  ) => Promise<void>;
  readonly idleTimeoutMs?: number;
}

export interface BuildJobExecutionContext {
  readonly signal: AbortSignal;
}

export interface BuildJobProgressReporter {
  addOutputCharacters(characters: number): Promise<void>;
  addTokenUsage(usage: BuildJobTokenUsage): Promise<void>;
  setTotals(input: {
    readonly totalGraphWords?: number;
    readonly totalReadingSummaryWords?: number;
  }): Promise<void>;
  stepCompleted(step: BuildJobTarget): Promise<void>;
  stepStarted(step: BuildJobTarget): Promise<void>;
  updateWords(input: {
    readonly graphWords?: number;
    readonly readingSummaryWords?: number;
  }): Promise<void>;
  updatePhase(input: {
    readonly done: number;
    readonly force?: boolean;
    readonly phase: BuildJobProgressPhase;
    readonly phaseDetail?: string;
    readonly total: number;
    readonly unit: BuildJobProgressUnit;
  }): Promise<void>;
  throwIfStopped(): Promise<void>;
}

export type BuildJobConflictScope =
  | {
      readonly kind: "archive";
    }
  | {
      readonly chapterIds: readonly number[];
      readonly kind: "chapter";
    };
