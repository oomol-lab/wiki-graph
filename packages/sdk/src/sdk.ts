import { WikiGraph } from "wiki-graph-core";

import { WikiGraphConfigManager } from "./config.js";
import { WikiGraphJobManager, type WikiGraphJobRuntime } from "./jobs.js";
import { WikiGraphLibraryManager } from "./libraries.js";
import {
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
  public readonly config: WikiGraphConfigManager;
  public readonly jobs: WikiGraphJobManager;
  public readonly libraries: WikiGraphLibraryManager;

  public constructor(options: WikiGraphSDKOptions = {}) {
    installNodeWikiGraphPlatform();
    this.#context = {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      envPolicy: options.envPolicy ?? "production",
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    };
    this.config = new WikiGraphConfigManager(this);
    this.jobs = new WikiGraphJobManager(this);
    this.libraries = new WikiGraphLibraryManager(this);
  }

  public get core(): WikiGraph {
    this.#core ??= new WikiGraph({});
    return this.#core;
  }

  public async run<T>(operation: () => Promise<T> | T): Promise<T> {
    return await withNodeWikiGraphStorage(
      this.#context.stateDir,
      async () =>
        await withWikiGraphSDKRuntimeContext(this.#context, operation),
    );
  }

  public close(): void {
    this.jobs.close();
  }
}

export function createWikiGraphSDK(
  options: WikiGraphSDKOptions = {},
): WikiGraphSDK {
  return new WikiGraphSDK(options);
}
