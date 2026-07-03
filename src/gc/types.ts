export interface GcContext {
  readonly force: boolean;
  readonly now: number;
  readonly stateDirectoryPath: string;
  readonly dryRun: boolean;
}

export interface GcJobResult {
  readonly scanned: number;
  readonly removed: number;
  readonly freedBytes: number;
}

export interface GcJobReport extends GcJobResult {
  readonly name: string;
  readonly error?: string;
}

export interface GcRunReport extends GcJobResult {
  readonly jobs: readonly GcJobReport[];
  readonly skipped: boolean;
  readonly startedAt: number;
  readonly finishedAt: number;
}

export type GcJob = (context: GcContext) => Promise<GcJobResult>;
