import {
  tryRunWikiGraphGc as tryRunCoreWikiGraphGc,
  type GcRunReport,
} from "wiki-graph-core/gc";

import { withWikiGraphSDKHost, type WikiGraphSDKHost } from "./host.js";

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
  readonly host?: WikiGraphSDKHost;
  readonly opportunistic?: boolean;
  /** Wiki Graph state root. Defaults to `~/.wikigraph`. */
  readonly stateDir?: string;
}

/** Run cleanup with the Node platform and storage scoped to this invocation. */
export async function tryRunWikiGraphGc(
  options: WikiGraphGcOptions = {},
): Promise<GcRunReport> {
  const { host, stateDir, ...coreOptions } = options;
  return await withWikiGraphSDKHost(
    {
      ...(host === undefined ? {} : { host }),
      ...(stateDir === undefined ? {} : { stateDir }),
    },
    async () => await tryRunCoreWikiGraphGc(coreOptions),
  );
}
