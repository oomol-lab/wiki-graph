import {
  addBuildJob,
  boostBuildJob,
  cancelBuildJob,
  cleanBuildJobs,
  formatLocatedChapterUri,
  getBuildJob,
  listBuildJobs,
  listChapters,
  pauseBuildJob,
  readBuildJobEvents,
  resolveBuildJobId,
  resumeBuildJob,
  updateBuildJobTarget,
  resolveChapterPathReadonly,
  WikiGraphArchiveFile,
  type AddBuildJobOptions,
  type BuildJob,
  type BuildJobEvent,
  type BuildJobEventChunk,
  type BuildJobListOptions,
  type BuildJobTarget,
  type ChapterEntry,
} from "wiki-graph-core";

import { getNodeResourcePath, NodeFile } from "./node-platform.js";
import { resolveWikiGraphArchiveLocation } from "./archive/index.js";
import { requireKnowledgeGraphWikispineConfig } from "./default-worker.js";
import { loadWikiGraphRuntimeConfig } from "./runtime-config.js";
import { loadRequiredStageConfig } from "./stage.js";
import { resolveWikiGraphRuntimePath } from "./runtime-path.js";

const TERMINAL_STATES = new Set(["canceled", "failed", "succeeded"]);
const TERMINAL_EVENT_GRACE_READS = 3;

export interface WikiGraphJobBackend {
  add(options: AddBuildJobOptions): Promise<BuildJob>;
  boost(jobId: string): Promise<BuildJob>;
  cancel(jobId: string): Promise<BuildJob>;
  get(jobId: string): Promise<BuildJob>;
  list(options: BuildJobListOptions): Promise<readonly BuildJob[]>;
  pause(jobId: string): Promise<BuildJob>;
  readEventChunk?(job: BuildJob, cursor: number): Promise<BuildJobEventChunk>;
  readEvents?(job: BuildJob): Promise<readonly BuildJobEvent[]>;
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
  readEventChunk: async (job, cursor) =>
    await readIncrementalBuildJobEvents(job, cursor),
  readEvents: async (job) => await readBuildJobEvents(job),
  resume: async (jobId) => await resumeBuildJob(jobId),
  setTarget: async (jobId, target) => await updateBuildJobTarget(jobId, target),
};

async function readIncrementalBuildJobEvents(
  job: BuildJob,
  cursor: number,
): Promise<BuildJobEventChunk> {
  let reader: Awaited<ReturnType<BuildJob["events"]["openReader"]>>;
  try {
    reader = await job.events.openReader();
  } catch {
    return { cursor, events: await readBuildJobEvents(job) };
  }
  try {
    const offset = cursor <= reader.size ? cursor : 0;
    const content = new TextDecoder().decode(
      await reader.read(offset, reader.size - offset),
    );
    return {
      cursor: reader.size,
      events: content
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as BuildJobEvent),
    };
  } finally {
    await reader.close();
  }
}

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

export interface WikiGraphJobChapterReference {
  readonly locatedUri: string;
  readonly title: string | null;
  readonly uri: string;
}

export interface WikiGraphJobEnqueueOptions {
  readonly archive: string;
  readonly boost?: boolean;
  readonly chapterId?: number;
  readonly chapterIds?: readonly number[];
  readonly chapterPath?: string;
  readonly depth?: number;
  readonly llmJSON?: string;
  readonly prompt?: string;
  readonly target?: BuildJobTarget;
}

export interface WikiGraphJobEnqueueResult {
  readonly created: readonly {
    readonly chapter: ChapterEntry;
    readonly job: WikiGraphJob;
  }[];
  readonly skipped: readonly {
    readonly chapter: ChapterEntry;
    readonly reason: string;
  }[];
}

export interface WikiGraphJobEnqueuePlan {
  readonly ready: readonly ChapterEntry[];
  readonly skipped: readonly {
    readonly chapter: ChapterEntry;
    readonly reason: string;
  }[];
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
  run<T>(
    operation: () => Promise<T> | T,
    signal?: AbortSignal,
    options?: { readonly skipHomeBootstrap?: boolean },
  ): Promise<T>;
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
              ? new NodeFile(resolveWikiGraphRuntimePath(options.archive))
              : options.archive,
        }),
    );
    return this.#createHandle(job);
  }

  public async clean(): Promise<number> {
    return await this.#runtime.run(async () => await cleanBuildJobs());
  }

  public async get(jobId: string): Promise<WikiGraphJob> {
    return this.#createHandle(
      await this.#runtime.run(async () => await this.#backend.get(jobId)),
    );
  }

  public async resolveId(reference: string): Promise<string> {
    return await this.#runtime.run(
      async () => await resolveBuildJobId(reference),
    );
  }

  public async list(
    options: WikiGraphJobListOptions = {},
  ): Promise<readonly WikiGraphJob[]> {
    const jobs = await this.#runtime.run(async () => {
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
                  ? new NodeFile(resolveWikiGraphRuntimePath(options.archive))
                  : options.archive,
            }),
      };
      return await this.#backend.list(normalized);
    });
    return jobs.map((job) => this.#createHandle(job));
  }

  public async resolveChapters(
    jobs: readonly BuildJob[],
  ): Promise<ReadonlyMap<string, WikiGraphJobChapterReference>> {
    return await this.#runtime.run(async () => {
      const jobsByArchive = new Map<string, BuildJob[]>();
      for (const job of jobs) {
        const archivePath = getBuildJobArchivePath(job);
        const grouped = jobsByArchive.get(archivePath) ?? [];
        grouped.push(job);
        jobsByArchive.set(archivePath, grouped);
      }
      const entries = (
        await Promise.all(
          [...jobsByArchive].map(async ([archivePath, archiveJobs]) => {
            try {
              const chapters = await new WikiGraphArchiveFile(
                new NodeFile(archivePath),
              ).readDocument(async (document) => await listChapters(document));
              const chaptersById = new Map(
                chapters.map((chapter) => [chapter.chapterId, chapter]),
              );
              return archiveJobs.flatMap((job) => {
                const chapter = chaptersById.get(job.chapterId);
                return chapter === undefined
                  ? []
                  : [
                      [
                        job.jobId,
                        {
                          locatedUri: formatLocatedChapterUri(
                            archivePath,
                            chapter.path,
                          ),
                          title: chapter.title,
                          uri: chapter.uri,
                        },
                      ] as const,
                    ];
              });
            } catch {
              return [];
            }
          }),
        )
      ).flat();
      return new Map(entries);
    });
  }

  public async resolveChapter(
    job: BuildJob,
  ): Promise<WikiGraphJobChapterReference | undefined> {
    return (await this.resolveChapters([job])).get(job.jobId);
  }

  public async enqueue(
    options: WikiGraphJobEnqueueOptions,
  ): Promise<WikiGraphJobEnqueueResult> {
    return await this.#runtime.run(async () => {
      const location = await resolveWikiGraphArchiveLocation(options.archive);
      const target = options.target ?? "reading-summary";
      await validateQueueTargetConfig(target, options.llmJSON);
      const selectedExplicitly =
        options.chapterId !== undefined ||
        options.chapterIds !== undefined ||
        options.chapterPath !== undefined ||
        options.depth !== undefined;
      const candidates = await new WikiGraphArchiveFile(
        location.archiveFile,
      ).readDocument(async (document) => {
        const chapters = await listChapters(document);
        const selected = await selectQueueChapters(document, chapters, options);
        const checked = await Promise.all(
          selected.map(async (chapter) => ({
            chapter,
            reason: await readQueueReadinessReason(document, chapter, target),
          })),
        );
        return checked;
      });
      const created: Array<{ chapter: ChapterEntry; job: WikiGraphJob }> = [];
      const skipped: Array<{ chapter: ChapterEntry; reason: string }> = [];
      for (const candidate of candidates) {
        if (candidate.reason !== undefined) {
          if (selectedExplicitly && candidates.length === 1) {
            throw new Error(
              formatQueueReadinessError(
                candidate.chapter,
                target,
                candidate.reason,
              ),
            );
          }
          skipped.push({
            chapter: candidate.chapter,
            reason: candidate.reason,
          });
          continue;
        }
        try {
          created.push({
            chapter: candidate.chapter,
            job: await this.create({
              archive: location.archiveFile,
              boost: options.boost ?? false,
              chapterId: candidate.chapter.chapterId,
              ...(options.llmJSON === undefined
                ? {}
                : { llmJSON: options.llmJSON }),
              ...(options.prompt === undefined
                ? {}
                : { prompt: options.prompt }),
              target,
            }),
          });
        } catch (error) {
          if (selectedExplicitly && candidates.length === 1) throw error;
          skipped.push({
            chapter: candidate.chapter,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { created, skipped };
    });
  }

  public async planEnqueue(
    options: WikiGraphJobEnqueueOptions,
  ): Promise<WikiGraphJobEnqueuePlan> {
    return await this.#runtime.run(async () => {
      const location = await resolveWikiGraphArchiveLocation(options.archive);
      const target = options.target ?? "reading-summary";
      await validateQueueTargetConfig(target, options.llmJSON);
      const selectedExplicitly =
        options.chapterId !== undefined ||
        options.chapterIds !== undefined ||
        options.chapterPath !== undefined ||
        options.depth !== undefined;
      const candidates = await new WikiGraphArchiveFile(
        location.archiveFile,
      ).readDocument(async (document) => {
        const chapters = await listChapters(document);
        const selected = await selectQueueChapters(document, chapters, options);
        return await Promise.all(
          selected.map(async (chapter) => ({
            chapter,
            reason: await readQueueReadinessReason(document, chapter, target),
          })),
        );
      });
      if (
        selectedExplicitly &&
        candidates.length === 1 &&
        candidates[0]?.reason !== undefined
      ) {
        throw new Error(
          formatQueueReadinessError(
            candidates[0].chapter,
            target,
            candidates[0].reason,
          ),
        );
      }
      return {
        ready: candidates
          .filter((item) => item.reason === undefined)
          .map((item) => item.chapter),
        skipped: candidates.flatMap((item) =>
          item.reason === undefined
            ? []
            : [{ chapter: item.chapter, reason: item.reason }],
        ),
      };
    });
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

function getBuildJobArchivePath(job: BuildJob): string {
  const record = job as unknown as Record<string, unknown>;
  if (record.archive !== undefined) {
    return getNodeResourcePath(record.archive as BuildJob["archive"]);
  }
  if (typeof record.archivePath === "string") return record.archivePath;
  throw new TypeError("Build job is missing archive");
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
    let cursor = 0;
    let job = this.#snapshot;
    if (options.from === "now") {
      job = await this.status();
      const chunk = await this.#readEventChunkSafely(job, cursor);
      const events = chunk.events;
      cursor = chunk.cursor;
      seenSeq = events.at(-1)?.seq ?? 0;
      if (isTerminalState(job.state)) return;
    }

    let terminalReadsWithoutEvent = 0;
    while (options.signal?.aborted !== true) {
      const chunk = await this.#readEventChunkSafely(job, cursor);
      const events = chunk.events;
      cursor = chunk.cursor;
      let sawTerminalEvent = false;
      for (const event of events) {
        if (event.seq <= seenSeq) continue;
        seenSeq = event.seq;
        sawTerminalEvent ||= isTerminalEvent(event);
        yield event;
      }
      if (sawTerminalEvent) return;

      job = await this.status();
      if (isTerminalState(job.state)) {
        terminalReadsWithoutEvent += 1;
        if (terminalReadsWithoutEvent >= TERMINAL_EVENT_GRACE_READS) return;
      } else {
        terminalReadsWithoutEvent = 0;
      }
      await wait(options.pollIntervalMs ?? 1_000, options.signal);
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

  async #readEventChunk(
    job: BuildJob,
    cursor: number,
  ): Promise<BuildJobEventChunk> {
    return await this.#runtime.run(async () => {
      if (this.#backend.readEventChunk !== undefined) {
        return await this.#backend.readEventChunk(job, cursor);
      }
      const events = await this.#backend.readEvents?.(job);
      return { cursor: 0, events: events ?? [] };
    });
  }

  async #readEventChunkSafely(
    job: BuildJob,
    cursor: number,
  ): Promise<BuildJobEventChunk> {
    try {
      return await this.#readEventChunk(job, cursor);
    } catch {
      return { cursor, events: [] };
    }
  }
}

async function selectQueueChapters(
  document: Parameters<typeof listChapters>[0],
  chapters: readonly ChapterEntry[],
  options: WikiGraphJobEnqueueOptions,
): Promise<readonly ChapterEntry[]> {
  const ids =
    options.chapterIds ??
    (options.chapterId === undefined ? undefined : [options.chapterId]);
  if (ids !== undefined) {
    const selected = new Set(ids);
    for (const id of selected) requireQueueChapter(chapters, id);
    return chapters.filter((chapter) => selected.has(chapter.chapterId));
  }
  if (options.chapterPath === undefined) {
    return options.depth === undefined
      ? chapters
      : chapters.filter((chapter) => chapter.depth <= options.depth!);
  }
  const rootId = await resolveChapterPathReadonly(
    document,
    options.chapterPath,
  );
  const root = requireQueueChapter(chapters, rootId);
  const prefix = `${root.path}/`;
  return chapters.filter(
    (chapter) =>
      chapter.chapterId === rootId ||
      (chapter.path.startsWith(prefix) &&
        (options.depth === undefined ||
          chapter.depth - root.depth <= options.depth)),
  );
}

async function validateQueueTargetConfig(
  target: BuildJobTarget,
  llmJSON: string | undefined,
): Promise<void> {
  const config =
    target === "knowledge-graph" ||
    target === "reading-graph" ||
    target === "reading-summary"
      ? await loadRequiredStageConfig({
          ...(llmJSON === undefined ? {} : { llmJSON }),
        })
      : await loadWikiGraphRuntimeConfig({
          ...(llmJSON === undefined ? {} : { llmJSON }),
        });
  if (
    (target === "index-embedding-source" ||
      target === "index-embedding-summary") &&
    config.embedding === undefined
  ) {
    throw new Error(
      "Missing embeddings configuration. Configure `wikg://local/config/embeddings` before queueing embedding index artifact jobs.",
    );
  }
  if (target === "knowledge-graph")
    requireKnowledgeGraphWikispineConfig(config);
}

function requireQueueChapter(
  chapters: readonly ChapterEntry[],
  chapterId: number,
): ChapterEntry {
  const chapter = chapters.find((entry) => entry.chapterId === chapterId);
  if (chapter === undefined)
    throw new Error(`Chapter ${chapterId} does not exist.`);
  return chapter;
}

async function readQueueReadinessReason(
  document: Parameters<typeof listChapters>[0],
  chapter: ChapterEntry,
  target: BuildJobTarget,
): Promise<string | undefined> {
  if (chapter.stage === "planned") {
    return "planned";
  }
  if (target === "index-embedding-summary") {
    const summary = await document.readSummary(chapter.chapterId);
    if (summary === undefined || summary.trim() === "") {
      return "missing summary";
    }
  }
  if (target === "knowledge-graph" || target === "reading-graph") {
    const [artifact, revision] = await Promise.all([
      document.indexArtifacts.get(chapter.chapterId, "fts"),
      document.serials.getRevision(chapter.chapterId),
    ]);
    if (artifact?.sourceRevision !== revision) {
      return "missing current FTS index artifact";
    }
  }
  return undefined;
}

function formatQueueReadinessError(
  chapter: ChapterEntry,
  target: BuildJobTarget,
  reason: string,
): string {
  if (reason === "planned") {
    return `Chapter ${chapter.uri} is planned. Set source before queueing a build job.`;
  }
  if (reason === "missing summary") {
    return `Chapter ${chapter.uri} has no summary. Build a reading summary before queueing a summary embedding index artifact job.`;
  }
  if (reason === "missing current FTS index artifact") {
    return `Chapter ${chapter.uri} needs a current FTS index artifact before queueing ${target}.`;
  }
  return reason;
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

function isTerminalState(state: BuildJob["state"]): boolean {
  return TERMINAL_STATES.has(state);
}

function isTerminalEvent(event: BuildJobEvent): boolean {
  return (
    event.type === "canceled" ||
    event.type === "failed" ||
    event.type === "succeeded"
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
