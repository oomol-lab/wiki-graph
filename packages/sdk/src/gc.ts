import {
  tryRunWikiGraphGc as tryRunCoreWikiGraphGc,
  type GcRunReport,
} from "wiki-graph-core/gc";

import {
  installNodeWikiGraphPlatform,
  withNodeWikiGraphStorage,
} from "./node-platform.js";

export type {
  GcContext,
  GcJob,
  GcJobReport,
  GcJobResult,
  GcRunReport,
} from "wiki-graph-core/gc";

export interface WikiGraphGcOptions {
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly opportunistic?: boolean;
  /** Wiki Graph state root. Defaults to `~/.wikigraph`. */
  readonly stateDir?: string;
}

/** Run cleanup with the Node platform and storage scoped to this invocation. */
export async function tryRunWikiGraphGc(
  options: WikiGraphGcOptions = {},
): Promise<GcRunReport> {
  installNodeWikiGraphPlatform();
  const { stateDir, ...coreOptions } = options;
  return await withNodeWikiGraphStorage(
    stateDir,
    async () => await tryRunCoreWikiGraphGc(coreOptions),
  );
}
