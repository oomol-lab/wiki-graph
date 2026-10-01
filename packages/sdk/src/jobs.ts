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
  readonly #subscriptions = new Set<AbortController>();

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async create(
    options: WikiGraphJobCreateOptions,
  ): Promise<WikiGraphJob> {
    const job = await this.#runtime.run(
      async () =>
        await addBuildJob({
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
      await this.#runtime.run(async () => await getBuildJob(jobId)),
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
      async () => await listBuildJobs(normalized),
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
    return new WikiGraphJob(this, this.#runtime, snapshot);
  }
}

export class WikiGraphJob {
  readonly #manager: WikiGraphJobManager;
  readonly #runtime: WikiGraphJobRuntime;
  #snapshot: BuildJob;

  public constructor(
    manager: WikiGraphJobManager,
    runtime: WikiGraphJobRuntime,
    snapshot: BuildJob,
  ) {
    this.#manager = manager;
    this.#runtime = runtime;
    this.#snapshot = snapshot;
  }

  public get id(): string {
    return this.#snapshot.jobId;
  }

  public get snapshot(): BuildJob {
    return this.#snapshot;
  }

  public async status(): Promise<BuildJob> {
    return await this.#update(async () => await getBuildJob(this.id));
  }

  public async pause(): Promise<BuildJob> {
    return await this.#update(async () => await pauseBuildJob(this.id));
  }

  public async resume(): Promise<BuildJob> {
    return await this.#update(async () => await resumeBuildJob(this.id));
  }

  public async cancel(): Promise<BuildJob> {
    return await this.#update(async () => await cancelBuildJob(this.id));
  }

  public async boost(): Promise<BuildJob> {
    return await this.#update(async () => await boostBuildJob(this.id));
  }

  public async setTarget(target: BuildJobTarget): Promise<BuildJob> {
    return await this.#update(
      async () => await updateBuildJobTarget(this.id, target),
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
        async () => await readBuildJobEvents(job),
      );
      seenSeq = events.at(-1)?.seq ?? 0;
    }

    while (options.signal?.aborted !== true) {
      const events = await this.#runtime.run(
        async () => await readBuildJobEvents(job),
      );
      for (const event of events) {
        if (event.seq <= seenSeq) continue;
        seenSeq = event.seq;
        yield event;
      }
      if (TERMINAL_STATES.has(job.state)) return;
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
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
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
