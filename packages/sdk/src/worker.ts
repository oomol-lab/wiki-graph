import {
  applyChapterJobArtifactFile,
  runBuildJobWorker as runCoreBuildJobWorker,
  writeChapterJobInputFile,
  type ChapterJobInputOptions,
  type BuildJobWorkerOptions as CoreBuildJobWorkerOptions,
} from "wiki-graph-core/worker";
import {
  resolveChapterPathReadonly,
  WikiGraphArchiveFile,
} from "wiki-graph-core";
import type { ChapterJobKind } from "wiki-graph-job";

import {
  ensureNodeWikiGraphPlatform,
  NodeFile,
  installNodeWikiGraphPlatform,
  withNodeWikiGraphStorage,
} from "./node-platform.js";

export {
  applyChapterJobArtifactFile,
  createLocalChapterJobFileExecutor,
  writeChapterJobInputFile,
} from "wiki-graph-core/worker";
export type {
  BuildJob,
  BuildJobExecutionContext,
  BuildJobProgressReporter,
  BuildJobWorkerOptions,
  ChapterJobInputOptions,
  LocalChapterJobFileExecutorOptions,
} from "wiki-graph-core/worker";
export type { ChapterJobFileExecutor, ChapterJobKind } from "wiki-graph-job";

export interface WikiGraphJobArtifactInput {
  readonly artifactPath: string;
  readonly chapterId: number;
  readonly kind: ChapterJobKind;
}

export interface WikiGraphJobSnapshotInput {
  readonly chapterPath: string;
  readonly kind: ChapterJobKind;
  readonly options?: ChapterJobInputOptions;
  readonly outputPath: string;
}

export interface WikiGraphJobSnapshotResult extends WikiGraphJobSnapshotInput {
  readonly chapterId: number;
  readonly revision: number;
}

export interface ExtractWikiGraphJobSnapshotsOptions {
  readonly onSnapshot?: (
    snapshot: WikiGraphJobSnapshotResult,
  ) => void | Promise<void>;
  readonly requests: readonly WikiGraphJobSnapshotInput[];
  readonly signal?: AbortSignal;
  readonly stateDir: string;
  readonly wikgPath: string;
}

export async function extractWikiGraphJobSnapshots(
  options: ExtractWikiGraphJobSnapshotsOptions,
): Promise<readonly WikiGraphJobSnapshotResult[]> {
  ensureNodeWikiGraphPlatform();
  return await withNodeWikiGraphStorage(
    options.stateDir,
    async () =>
      await new WikiGraphArchiveFile(
        new NodeFile(options.wikgPath),
      ).readDocument(async (document) => {
        const results: WikiGraphJobSnapshotResult[] = [];
        for (const request of options.requests) {
          options.signal?.throwIfAborted();
          const chapterId = await resolveChapterPathReadonly(
            document,
            request.chapterPath,
          );
          const revision = await writeChapterJobInputFile(
            document,
            chapterId,
            request.kind,
            new NodeFile(request.outputPath),
            request.options,
          );
          const result = { ...request, chapterId, revision };
          results.push(result);
          await options.onSnapshot?.(result);
        }
        options.signal?.throwIfAborted();
        return results;
      }),
  );
}

export interface ApplyWikiGraphJobArtifactsOptions {
  readonly artifacts: AsyncIterable<WikiGraphJobArtifactInput>;
  readonly signal?: AbortSignal;
  readonly stateDir: string;
  readonly wikgPath: string;
}

export async function applyWikiGraphJobArtifacts(
  options: ApplyWikiGraphJobArtifactsOptions,
): Promise<{ readonly applied: number }> {
  ensureNodeWikiGraphPlatform();
  return await withNodeWikiGraphStorage(options.stateDir, async () => {
    let applied = 0;
    await new WikiGraphArchiveFile(new NodeFile(options.wikgPath)).write(
      async (document) => {
        for await (const artifact of options.artifacts) {
          options.signal?.throwIfAborted();
          const revision = await document.serials.getRevision(
            artifact.chapterId,
          );
          await applyChapterJobArtifactFile(
            document,
            artifact.chapterId,
            artifact.kind,
            revision,
            new NodeFile(artifact.artifactPath),
          );
          applied += 1;
        }
      },
    );
    options.signal?.throwIfAborted();
    return { applied };
  });
}

export interface WikiGraphBuildJobWorkerOptions extends CoreBuildJobWorkerOptions {
  /** Wiki Graph state root. Defaults to `~/.wikigraph`. */
  readonly stateDir?: string;
}

/** Run the persistent build worker with invocation-scoped Node storage. */
export async function runBuildJobWorker(
  options: WikiGraphBuildJobWorkerOptions,
): Promise<void> {
  installNodeWikiGraphPlatform();
  const { stateDir, ...coreOptions } = options;
  await withNodeWikiGraphStorage(
    stateDir,
    async () => await runCoreBuildJobWorker(coreOptions),
  );
}
