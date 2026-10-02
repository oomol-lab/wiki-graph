import {
  applyChapterJobArtifactFile,
  runBuildJobWorker as runCoreBuildJobWorker,
  type BuildJobWorkerOptions as CoreBuildJobWorkerOptions,
} from "wiki-graph-core/worker";
import { WikiGraphArchiveFile } from "wiki-graph-core";
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
