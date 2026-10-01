import {
  runBuildJobWorker as runCoreBuildJobWorker,
  type BuildJobWorkerOptions as CoreBuildJobWorkerOptions,
} from "wiki-graph-core/worker";

import {
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
