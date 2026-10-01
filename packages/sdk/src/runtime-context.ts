import { AsyncLocalStorage } from "async_hooks";

export type WikiGraphSDKEnvPolicy = "development" | "production";

export interface WikiGraphSDKRuntimeContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly envPolicy: WikiGraphSDKEnvPolicy;
  readonly stateDir?: string | undefined;
}

/** Shared by independently bundled SDK entry points in the same process. */
const RUNTIME_CONTEXT_KEY = Symbol.for("wiki-graph-sdk.runtime-context.v1");
const runtimeContext = getRuntimeContextStorage();

function getRuntimeContextStorage(): AsyncLocalStorage<WikiGraphSDKRuntimeContext> {
  const runtimeGlobal = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = runtimeGlobal[RUNTIME_CONTEXT_KEY];
  if (existing !== undefined) {
    return existing as AsyncLocalStorage<WikiGraphSDKRuntimeContext>;
  }

  const storage = new AsyncLocalStorage<WikiGraphSDKRuntimeContext>();
  Object.defineProperty(runtimeGlobal, RUNTIME_CONTEXT_KEY, {
    configurable: false,
    enumerable: false,
    value: storage,
    writable: false,
  });
  return storage;
}

export async function withWikiGraphSDKRuntimeContext<T>(
  context: WikiGraphSDKRuntimeContext,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await runtimeContext.run(context, operation);
}

export function getWikiGraphSDKRuntimeContext(): WikiGraphSDKRuntimeContext {
  return (
    runtimeContext.getStore() ?? {
      cwd: process.cwd(),
      env: process.env,
      envPolicy: "production",
    }
  );
}

export function getWikiGraphSDKStateDir(): string | undefined {
  return getWikiGraphSDKRuntimeContext().stateDir;
}
