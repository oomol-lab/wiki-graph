import { AsyncLocalStorage } from "async_hooks";
import { withWikiGraphSDKRuntimeContext } from "wiki-graph-sdk";
import { createWikiGraphSDK, type WikiGraphSDK } from "wiki-graph-sdk";

export interface WikiGraphCLIRuntimeContext {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly devProjectRoot?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly envPolicy: "development" | "production";
  readonly queueAutostart: boolean;
  readonly sdk?: WikiGraphSDK | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly stateDir?: string | undefined;
  readonly stderr: NodeJS.WritableStream;
  readonly stderrIsTTY?: boolean | undefined;
  readonly stdin: NodeJS.ReadableStream & { isTTY?: boolean | undefined };
  readonly stdinIsTTY?: boolean | undefined;
  readonly stdout: NodeJS.WritableStream;
  readonly stdoutIsTTY?: boolean | undefined;
  exitCode: NodeJS.Process["exitCode"];
}

const cliRuntimeContext = new AsyncLocalStorage<WikiGraphCLIRuntimeContext>();
let queueAutostartForTesting: boolean | undefined;

export async function withWikiGraphCLIRuntimeContext<T>(
  context: WikiGraphCLIRuntimeContext,
  operation: () => Promise<T> | T,
): Promise<T> {
  return await cliRuntimeContext.run(
    context,
    async () =>
      await withWikiGraphSDKRuntimeContext(
        {
          cwd: context.cwd,
          env: context.env,
          envPolicy: context.envPolicy,
          providers: {},
          ...(context.stateDir === undefined
            ? {}
            : { stateDir: context.stateDir }),
        },
        operation,
      ),
  );
}

export function getCLIArgv(): readonly string[] {
  return cliRuntimeContext.getStore()?.argv ?? process.argv.slice(2);
}

export function getWikiGraphSDK(): WikiGraphSDK {
  const context = cliRuntimeContext.getStore();
  return (
    context?.sdk ??
    createWikiGraphSDK({
      ...(context?.cwd === undefined ? {} : { cwd: context.cwd }),
      ...(context?.env === undefined ? {} : { env: context.env }),
      ...(context?.envPolicy === undefined
        ? {}
        : { envPolicy: context.envPolicy }),
      ...(context?.stateDir === undefined
        ? {}
        : { stateDir: context.stateDir }),
    })
  );
}

export function getCLICwd(): string {
  return cliRuntimeContext.getStore()?.cwd ?? process.cwd();
}

export function getCLIEnv(): NodeJS.ProcessEnv {
  return cliRuntimeContext.getStore()?.env ?? process.env;
}

export function getCLIEnvValue(name: string): string | undefined {
  return getCLIEnv()[name];
}

export function getCLIDevProjectRoot(): string | undefined {
  return cliRuntimeContext.getStore()?.devProjectRoot;
}

export function getCLIStateDir(): string | undefined {
  return cliRuntimeContext.getStore()?.stateDir;
}

export function getCLIEnvPolicy(): "development" | "production" {
  return cliRuntimeContext.getStore()?.envPolicy ?? "production";
}

export function isCLIQueueAutostartEnabled(): boolean {
  return (
    queueAutostartForTesting ??
    cliRuntimeContext.getStore()?.queueAutostart ??
    true
  );
}

export function setCLIQueueAutostartForTesting(
  enabled: boolean | undefined,
): void {
  queueAutostartForTesting = enabled;
}

export function getCLISignal(): AbortSignal | undefined {
  return cliRuntimeContext.getStore()?.signal;
}

export function getCLIStdin(): NodeJS.ReadableStream & {
  isTTY?: boolean | undefined;
} {
  return (
    cliRuntimeContext.getStore()?.stdin ??
    (process.stdin as NodeJS.ReadableStream & { isTTY?: boolean | undefined })
  );
}

export function getCLIStdout(): NodeJS.WritableStream {
  return cliRuntimeContext.getStore()?.stdout ?? process.stdout;
}

export function getCLIStderr(): NodeJS.WritableStream {
  return cliRuntimeContext.getStore()?.stderr ?? process.stderr;
}

export function getCLIStdoutIsTTY(): boolean | undefined {
  const context = cliRuntimeContext.getStore();

  return (
    context?.stdoutIsTTY ??
    (getCLIStdout() as NodeJS.WritableStream & { isTTY?: boolean }).isTTY
  );
}

export function getCLIExitCode(): NodeJS.Process["exitCode"] {
  return cliRuntimeContext.getStore()?.exitCode ?? process.exitCode;
}

export function setCLIExitCode(exitCode: NodeJS.Process["exitCode"]): void {
  const context = cliRuntimeContext.getStore();

  if (context === undefined) {
    process.exitCode = exitCode;
    return;
  }

  context.exitCode = exitCode;
}
