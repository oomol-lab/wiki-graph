import {
  installWikiGraphPlatform,
  withWikiGraphStorage,
  type WikiGraphPlatform,
  type WikiGraphStorage,
} from "wiki-graph-core/platform";

import {
  ensureNodeWikiGraphPlatform,
  withNodeWikiGraphStorage,
} from "./node-platform.js";
import {
  getWikiGraphSDKRuntimeContext,
  withWikiGraphSDKRuntimeContext,
} from "./runtime-context.js";

interface WikiGraphSDKHostBase {
  /** Process-wide runtime services. Concurrent SDKs must use one compatible platform. */
  readonly platform?: WikiGraphPlatform;
}

export type WikiGraphSDKHost = WikiGraphSDKHostBase &
  (
    | {
        /** Node state root for SDK configuration and other host-local state. */
        readonly stateDir: string;
        /** Storage roots scoped to this SDK instance or standalone operation. */
        readonly storage: WikiGraphStorage;
      }
    | {
        /** Node state root used by the default Node storage layout. */
        readonly stateDir?: string;
        readonly storage?: undefined;
      }
  );

export interface WikiGraphSDKHostOptions {
  readonly host?: WikiGraphSDKHost;
  readonly stateDir?: string;
}

export function prepareWikiGraphSDKHost(host?: WikiGraphSDKHost): void {
  if (host?.platform === undefined) {
    ensureNodeWikiGraphPlatform();
    return;
  }
  installWikiGraphPlatform(host.platform);
}

export function assertWikiGraphSDKHostOptions(
  options: WikiGraphSDKHostOptions,
): void {
  if (
    options.host?.storage !== undefined &&
    options.host.stateDir === undefined
  ) {
    throw new TypeError(
      "Wiki Graph SDK host.storage requires host.stateDir so SDK configuration cannot fall back to the default user state directory.",
    );
  }
  if (
    options.stateDir !== undefined &&
    (options.host?.stateDir !== undefined ||
      options.host?.storage !== undefined)
  ) {
    throw new TypeError(
      "Wiki Graph SDK host state/storage and top-level stateDir cannot be used together. Put the state directory in host.stateDir when providing host.storage.",
    );
  }
}

export async function withWikiGraphSDKHost<T>(
  options: WikiGraphSDKHostOptions,
  operation: () => Promise<T> | T,
): Promise<T> {
  const current = getWikiGraphSDKRuntimeContext();
  const effective = {
    ...(options.host === undefined
      ? current.host === undefined
        ? {}
        : { host: current.host }
      : { host: options.host }),
    ...(options.stateDir === undefined
      ? current.stateDir === undefined
        ? {}
        : { stateDir: current.stateDir }
      : { stateDir: options.stateDir }),
  };
  assertWikiGraphSDKHostOptions(effective);
  prepareWikiGraphSDKHost(effective.host);
  const runWithContext = async (): Promise<T> =>
    await withWikiGraphSDKRuntimeContext(
      {
        ...current,
        ...(effective.host === undefined ? {} : { host: effective.host }),
        ...(effective.stateDir === undefined
          ? {}
          : { stateDir: effective.stateDir }),
      },
      operation,
    );
  if (effective.host?.storage !== undefined) {
    return await withWikiGraphStorage(effective.host.storage, runWithContext);
  }
  return await withNodeWikiGraphStorage(
    effective.host?.stateDir ?? effective.stateDir,
    runWithContext,
  );
}
