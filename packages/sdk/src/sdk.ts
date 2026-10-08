import { ensureWikiGraphHomeSchemaCurrent } from "wiki-graph-core";

import { WikiGraphArchiveManager } from "./archive/index.js";
import { WikiGraphConversionManager } from "./conversions.js";
import { WikiGraphConfigManager } from "./config.js";
import { WikiGraphContinuationManager } from "./continuations.js";
import { WikiGraphJobManager, type WikiGraphJobRuntime } from "./jobs.js";
import { WikiGraphLibraryManager } from "./libraries.js";
import { WikiGraphMaintenanceManager } from "./maintenance.js";
import {
  ensureNodeWikiGraphPlatform,
  withNodeWikiGraphStorage,
} from "./node-platform.js";
import {
  withWikiGraphSDKRuntimeContext,
  type WikiGraphSDKEnvPolicy,
  type WikiGraphSDKRuntimeContext,
} from "./runtime-context.js";
import type { WikiGraphSDKProviders } from "./providers.js";

export interface WikiGraphSDKOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly envPolicy?: WikiGraphSDKEnvPolicy;
  readonly providers?: WikiGraphSDKProviders;
  readonly stateDir?: string;
}

export class WikiGraphSDK implements WikiGraphJobRuntime {
  readonly #context: WikiGraphSDKRuntimeContext;
  #homeReady: Promise<void> | undefined;
  public readonly archives: WikiGraphArchiveManager;
  public readonly conversions: WikiGraphConversionManager;
  public readonly config: WikiGraphConfigManager;
  public readonly continuations: WikiGraphContinuationManager;
  public readonly jobs: WikiGraphJobManager;
  public readonly libraries: WikiGraphLibraryManager;
  public readonly maintenance: WikiGraphMaintenanceManager;

  public constructor(options: WikiGraphSDKOptions = {}) {
    ensureNodeWikiGraphPlatform();
    this.#context = {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      envPolicy: options.envPolicy ?? "production",
      providers: { ...options.providers },
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    };
    this.archives = new WikiGraphArchiveManager(this);
    this.conversions = new WikiGraphConversionManager(this);
    this.config = new WikiGraphConfigManager(this);
    this.continuations = new WikiGraphContinuationManager(this);
    this.jobs = new WikiGraphJobManager(this);
    this.libraries = new WikiGraphLibraryManager(this);
    this.maintenance = new WikiGraphMaintenanceManager(this);
  }

  public async run<T>(
    operation: () => Promise<T> | T,
    signal?: AbortSignal,
    options: { readonly skipHomeBootstrap?: boolean } = {},
  ): Promise<T> {
    throwIfAborted(signal);
    const runWithContext = async (): Promise<T> =>
      await withWikiGraphSDKRuntimeContext(this.#context, async () => {
        if (options.skipHomeBootstrap !== true) {
          this.#homeReady ??= ensureWikiGraphHomeSchemaCurrent().catch(
            (error: unknown) => {
              this.#homeReady = undefined;
              throw error;
            },
          );
          await this.#homeReady;
        }
        return await operation();
      });
    const result =
      this.#context.stateDir === undefined
        ? await runWithContext()
        : await withNodeWikiGraphStorage(
            this.#context.stateDir,
            runWithContext,
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
