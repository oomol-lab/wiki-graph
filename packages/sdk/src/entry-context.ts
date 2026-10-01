/** Controls whether development-only environment overrides are accepted. */
export type WikiGraphEntryEnvPolicy = "development" | "production";

export interface WikiGraphEntryRuntimeOptions {
  readonly argv?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly devProjectRoot?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly envPolicy: WikiGraphEntryEnvPolicy;
  readonly stateDir?: string | undefined;
}

export interface WikiGraphEntryRuntimeContext {
  readonly devProjectRoot?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly envPolicy: WikiGraphEntryEnvPolicy;
  readonly stateDir?: string | undefined;
}

export const DANGEROUS_RUNTIME_ENV_NAMES = [
  "WIKIGRAPH_DEV",
  "WIKIGRAPH_ENV_POLICY",
  "WIKIGRAPH_QUEUE_DISABLE_AUTOSTART",
  "WIKIGRAPH_STATE_DIR",
] as const;

export function createEntryRuntimeContext(
  options: WikiGraphEntryRuntimeOptions,
): WikiGraphEntryRuntimeContext {
  const environment = createMergedEnvironment(options.env);

  if (options.envPolicy === "production") {
    const blocked = DANGEROUS_RUNTIME_ENV_NAMES.filter(
      (name) => environment[name] !== undefined,
    );

    if (blocked.length > 0) {
      throw new Error(
        `Wiki Graph production entries do not support runtime env overrides: ${blocked.join(", ")}. Use the development entry or explicit SDK options instead.`,
      );
    }

    return {
      env: environment,
      envPolicy: options.envPolicy,
      stateDir: options.stateDir,
    };
  }

  const envStateDir =
    environment.WIKIGRAPH_DEV ?? environment.WIKIGRAPH_STATE_DIR;
  const stateDir = normalizeOptionalPath(options.stateDir ?? envStateDir);

  if (stateDir === undefined) {
    throw new Error(
      "Wiki Graph development entries require an explicit runtime state directory.",
    );
  }

  const devProjectRoot = normalizeOptionalPath(options.devProjectRoot);

  if (devProjectRoot === undefined) {
    throw new Error(
      "Wiki Graph development entries require an explicit project root.",
    );
  }

  return {
    devProjectRoot,
    env: environment,
    envPolicy: options.envPolicy,
    stateDir,
  };
}

function createMergedEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  if (environment === undefined) {
    return { ...process.env };
  }

  return {
    ...process.env,
    ...environment,
  };
}

function normalizeOptionalPath(path: string | undefined): string | undefined {
  if (path === undefined || path.trim() === "") {
    return undefined;
  }

  return path;
}
