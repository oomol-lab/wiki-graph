import {
  addBuildJob,
  boostBuildJob,
  cancelBuildJob,
  getBuildJob,
  listBuildJobs,
  pauseBuildJob,
  readBuildJobEvents,
  resumeBuildJob,
  updateBuildJobTarget,
  type AddBuildJobOptions,
  type BuildJob,
  type BuildJobEvent,
  type BuildJobListOptions,
  type BuildJobTarget,
} from "wiki-graph-core";

import { NodeFile } from "./node-platform.js";

const TERMINAL_STATES = new Set(["canceled", "failed", "succeeded"]);

export interface WikiGraphJobBackend {
  add(options: AddBuildJobOptions): Promise<BuildJob>;
  boost(jobId: string): Promise<BuildJob>;
  cancel(jobId: string): Promise<BuildJob>;
  get(jobId: string): Promise<BuildJob>;
  list(options: BuildJobListOptions): Promise<readonly BuildJob[]>;
  pause(jobId: string): Promise<BuildJob>;
  readEvents(job: BuildJob): Promise<readonly BuildJobEvent[]>;
  resume(jobId: string): Promise<BuildJob>;
  setTarget(jobId: string, target: BuildJobTarget): Promise<BuildJob>;
}

const CORE_BUILD_JOB_BACKEND: WikiGraphJobBackend = {
  add: async (options) => await addBuildJob(options),
  boost: async (jobId) => await boostBuildJob(jobId),
  cancel: async (jobId) => await cancelBuildJob(jobId),
  get: async (jobId) => await getBuildJob(jobId),
  list: async (options) => await listBuildJobs(options),
  pause: async (jobId) => await pauseBuildJob(jobId),
  readEvents: async (job) => await readBuildJobEvents(job),
  resume: async (jobId) => await resumeBuildJob(jobId),
  setTarget: async (jobId, target) => await updateBuildJobTarget(jobId, target),
};

export interface WikiGraphJobCreateOptions extends Omit<
  AddBuildJobOptions,
  "archive"
> {
  readonly archive: string | AddBuildJobOptions["archive"];
}

export interface WikiGraphJobListOptions extends Omit<
  BuildJobListOptions,
  "archive"
> {
  readonly archive?: string | BuildJobListOptions["archive"];
}

export interface WikiGraphJobEventsOptions {
  readonly from?: "beginning" | "now";
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
}

export type WikiGraphJobEventListener = (
  event: BuildJobEvent,
) => void | Promise<void>;

export interface WikiGraphJobSubscriptionOptions extends WikiGraphJobEventsOptions {
  readonly onError?: (error: unknown) => void;
}

export interface WikiGraphJobRuntime {
  run<T>(operation: () => Promise<T> | T): Promise<T>;
}

export class WikiGraphJobManager {
  readonly #runtime: WikiGraphJobRuntime;
  readonly #backend: WikiGraphJobBackend;
  readonly #subscriptions = new Set<AbortController>();

  public constructor(
    runtime: WikiGraphJobRuntime,
    backend: WikiGraphJobBackend = CORE_BUILD_JOB_BACKEND,
  ) {
    this.#runtime = runtime;
    this.#backend = backend;
  }

  public async create(
    options: WikiGraphJobCreateOptions,
  ): Promise<WikiGraphJob> {
    const job = await this.#runtime.run(
      async () =>
        await this.#backend.add({
          ...options,
          archive:
            typeof options.archive === "string"
              ? new NodeFile(options.archive)
              : options.archive,
        }),
    );
    return this.#createHandle(job);
  }

  public async get(jobId: string): Promise<WikiGraphJob> {
    return this.#createHandle(
      await this.#runtime.run(async () => await this.#backend.get(jobId)),
    );
  }

  public async list(
    options: WikiGraphJobListOptions = {},
  ): Promise<readonly WikiGraphJob[]> {
    const normalized: BuildJobListOptions = {
      ...(options.activeOnly === undefined
        ? {}
        : { activeOnly: options.activeOnly }),
      ...(options.all === undefined ? {} : { all: options.all }),
      ...(options.archive === undefined
        ? {}
        : {
            archive:
              typeof options.archive === "string"
                ? new NodeFile(options.archive)
                : options.archive,
          }),
    };
    const jobs = await this.#runtime.run(
      async () => await this.#backend.list(normalized),
    );
    return jobs.map((job) => this.#createHandle(job));
  }

  public close(): void {
    for (const controller of this.#subscriptions) controller.abort();
    this.#subscriptions.clear();
  }

  public trackSubscription(controller: AbortController): () => void {
    this.#subscriptions.add(controller);
    return () => this.#subscriptions.delete(controller);
  }

  #createHandle(snapshot: BuildJob): WikiGraphJob {
    return new WikiGraphJob(this, this.#runtime, this.#backend, snapshot);
  }
}

export class WikiGraphJob {
  readonly #manager: WikiGraphJobManager;
  readonly #runtime: WikiGraphJobRuntime;
  readonly #backend: WikiGraphJobBackend;
  #snapshot: BuildJob;

  public constructor(
    manager: WikiGraphJobManager,
    runtime: WikiGraphJobRuntime,
    backend: WikiGraphJobBackend,
    snapshot: BuildJob,
  ) {
    this.#manager = manager;
    this.#runtime = runtime;
    this.#backend = backend;
    this.#snapshot = snapshot;
  }

  public get id(): string {
    return this.#snapshot.jobId;
  }

  public get snapshot(): BuildJob {
    return this.#snapshot;
  }

  public async status(): Promise<BuildJob> {
    return await this.#update(async () => await this.#backend.get(this.id));
  }

  public async pause(): Promise<BuildJob> {
    return await this.#update(async () => await this.#backend.pause(this.id));
  }

  public async resume(): Promise<BuildJob> {
    return await this.#update(async () => await this.#backend.resume(this.id));
  }

  public async cancel(): Promise<BuildJob> {
    return await this.#update(async () => await this.#backend.cancel(this.id));
  }

  public async boost(): Promise<BuildJob> {
    return await this.#update(async () => await this.#backend.boost(this.id));
  }

  public async setTarget(target: BuildJobTarget): Promise<BuildJob> {
    return await this.#update(
      async () => await this.#backend.setTarget(this.id, target),
    );
  }

  public async *events(
    options: WikiGraphJobEventsOptions = {},
  ): AsyncIterable<BuildJobEvent> {
    let seenSeq = 0;
    let job = this.#snapshot;
    if (options.from === "now") {
      job = await this.status();
      const events = await this.#runtime.run(
        async () => await this.#backend.readEvents(job),
      );
      seenSeq = events.at(-1)?.seq ?? 0;
    }

    while (options.signal?.aborted !== true) {
      const events = await this.#runtime.run(
        async () => await this.#backend.readEvents(job),
      );
      for (const event of events) {
        if (event.seq <= seenSeq) continue;
        seenSeq = event.seq;
        yield event;
      }
      if (hasTerminalEvent(events, job.state)) return;
      await wait(options.pollIntervalMs ?? 1_000, options.signal);
      if (options.signal?.aborted) return;
      job = await this.status();
    }
  }

  public subscribe(
    listener: WikiGraphJobEventListener,
    options: WikiGraphJobSubscriptionOptions = {},
  ): () => void {
    const controller = new AbortController();
    const untrack = this.#manager.trackSubscription(controller);
    const stopForwarding = forwardAbort(options.signal, controller);
    void (async () => {
      try {
        for await (const event of this.events({
          ...options,
          signal: controller.signal,
        })) {
          try {
            await listener(event);
          } catch (error) {
            options.onError?.(error);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) options.onError?.(error);
      } finally {
        stopForwarding();
        untrack();
      }
    })();
    return () => controller.abort();
  }

  async #update(operation: () => Promise<BuildJob>): Promise<BuildJob> {
    this.#snapshot = await this.#runtime.run(operation);
    return this.#snapshot;
  }
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const complete = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", complete);
      resolve();
    };
    const timeout = setTimeout(complete, milliseconds);
    signal?.addEventListener("abort", complete, { once: true });
    if (signal?.aborted === true) complete();
  });
}

function hasTerminalEvent(
  events: readonly BuildJobEvent[],
  state: BuildJob["state"],
): boolean {
  if (!TERMINAL_STATES.has(state)) return false;
  return events.some(
    (event) =>
      (event.type === "canceled" ||
        event.type === "failed" ||
        event.type === "succeeded") &&
      event.state === state,
  );
}

function forwardAbort(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (source === undefined) return () => undefined;
  const abort = (): void => target.abort(source.reason);
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}
