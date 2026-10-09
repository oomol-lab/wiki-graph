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

export interface WikiGraphSDKHost {
  /** Process-wide runtime services. Concurrent SDKs must use one compatible platform. */
  readonly platform?: WikiGraphPlatform;
  /** Storage roots scoped to this SDK instance or standalone operation. */
  readonly storage?: WikiGraphStorage;
}

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
  if (options.host?.storage !== undefined && options.stateDir !== undefined) {
    throw new TypeError(
      "Wiki Graph SDK host.storage and stateDir cannot be used together.",
    );
  }
}

export async function withWikiGraphSDKHost<T>(
  options: WikiGraphSDKHostOptions,
  operation: () => Promise<T> | T,
): Promise<T> {
  assertWikiGraphSDKHostOptions(options);
  prepareWikiGraphSDKHost(options.host);
  if (options.host?.storage !== undefined) {
    return await withWikiGraphStorage(options.host.storage, operation);
  }
  return await withNodeWikiGraphStorage(options.stateDir, operation);
}
