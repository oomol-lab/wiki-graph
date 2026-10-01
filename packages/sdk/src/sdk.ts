import { WikiGraph } from "wiki-graph-core";

import { WikiGraphArchiveManager } from "./archives.js";
import { WikiGraphConversionManager } from "./conversions.js";
import { WikiGraphConfigManager } from "./config.js";
import { WikiGraphJobManager, type WikiGraphJobRuntime } from "./jobs.js";
import { WikiGraphLibraryManager } from "./libraries.js";
import { WikiGraphMaintenanceManager } from "./maintenance.js";
import {
  createNodeWikiGraphStorage,
  installNodeWikiGraphPlatform,
  withNodeWikiGraphStorage,
} from "./node-platform.js";
import {
  withWikiGraphSDKRuntimeContext,
  type WikiGraphSDKEnvPolicy,
  type WikiGraphSDKRuntimeContext,
} from "./runtime-context.js";

export interface WikiGraphSDKOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly envPolicy?: WikiGraphSDKEnvPolicy;
  readonly stateDir?: string;
}

export class WikiGraphSDK implements WikiGraphJobRuntime {
  readonly #context: WikiGraphSDKRuntimeContext;
  #core: WikiGraph | undefined;
  public readonly archives: WikiGraphArchiveManager;
  public readonly conversions: WikiGraphConversionManager;
  public readonly config: WikiGraphConfigManager;
  public readonly jobs: WikiGraphJobManager;
  public readonly libraries: WikiGraphLibraryManager;
  public readonly maintenance: WikiGraphMaintenanceManager;

  public constructor(options: WikiGraphSDKOptions = {}) {
    installNodeWikiGraphPlatform();
    this.#context = {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      envPolicy: options.envPolicy ?? "production",
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    };
    this.archives = new WikiGraphArchiveManager(this);
    this.conversions = new WikiGraphConversionManager();
    this.config = new WikiGraphConfigManager(this);
    this.jobs = new WikiGraphJobManager(this);
    this.libraries = new WikiGraphLibraryManager(this);
    this.maintenance = new WikiGraphMaintenanceManager(this);
  }

  public get core(): WikiGraph {
    this.#core ??= new WikiGraph({
      storage: createNodeWikiGraphStorage(this.#context.stateDir),
    });
    return this.#core;
  }

  public async run<T>(
    operation: () => Promise<T> | T,
    signal?: AbortSignal,
  ): Promise<T> {
    throwIfAborted(signal);
    const result = await withNodeWikiGraphStorage(
      this.#context.stateDir,
      async () =>
        await withWikiGraphSDKRuntimeContext(this.#context, operation),
    );
    throwIfAborted(signal);
    return result;
  }

  public close(): void {
    this.jobs.close();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("The Wiki Graph SDK operation was aborted.");
}

export function createWikiGraphSDK(
  options: WikiGraphSDKOptions = {},
): WikiGraphSDK {
  return new WikiGraphSDK(options);
}
