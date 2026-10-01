import { AsyncLocalStorage } from "async_hooks";

export type WikiGraphSDKEnvPolicy = "development" | "production";

export interface WikiGraphSDKRuntimeContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly envPolicy: WikiGraphSDKEnvPolicy;
  readonly stateDir?: string | undefined;
}

const runtimeContext = new AsyncLocalStorage<WikiGraphSDKRuntimeContext>();

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
