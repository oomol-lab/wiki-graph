import { withNodeWikiGraphStorage } from "./node-platform.js";
import { withWikiGraphCLIRuntimeContext } from "./context.js";

import {
  createEntryRuntimeContext,
  type WikiGraphEntryEnvPolicy,
} from "./entry-context.js";

export interface WorkerEntryArguments {
  readonly argv: readonly string[];
  readonly devProjectRoot?: string | undefined;
  readonly envPolicy: WikiGraphEntryEnvPolicy;
  readonly internalChild: string;
  readonly stateDir?: string | undefined;
}

const INTERNAL_CHILD_FLAG = "--wikigraph-internal-child";
const DEV_PROJECT_ROOT_FLAG = "--wikigraph-dev-project-root";
const ENV_POLICY_FLAG = "--wikigraph-env-policy";
const STATE_DIR_FLAG = "--wikigraph-state-dir";

export async function withWorkerEntryRuntime<T>(
  expectedInternalChild: string,
  operation: (args: WorkerEntryArguments) => Promise<T> | T,
): Promise<T> {
  const args = parseWorkerEntryArguments(process.argv.slice(2));

  if (args.internalChild !== expectedInternalChild) {
    throw new Error("This Wiki Graph worker entry is internal.");
  }

  const entryContext = createEntryRuntimeContext({
    argv: args.argv,
    devProjectRoot: args.devProjectRoot,
    envPolicy: args.envPolicy,
    stateDir: args.stateDir,
  });

  return await withNodeWikiGraphStorage(entryContext.stateDir, async () =>
    withWikiGraphCLIRuntimeContext(
      {
        argv: args.argv,
        cwd: process.cwd(),
        devProjectRoot: entryContext.devProjectRoot,
        env: entryContext.env,
        envPolicy: entryContext.envPolicy,
        exitCode: 0,
        queueAutostart: false,
        stateDir: entryContext.stateDir,
        stderr: process.stderr,
        stdin: process.stdin,
        stdout: process.stdout,
      },
      async () => await operation(args),
    ),
  );
}

function parseWorkerEntryArguments(
  argv: readonly string[],
): WorkerEntryArguments {
  const stripped: string[] = [];
  let internalChild: string | undefined;
  let devProjectRoot: string | undefined;
  let envPolicy: WikiGraphEntryEnvPolicy = "production";
  let stateDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;

    if (arg === INTERNAL_CHILD_FLAG) {
      if (index + 1 >= argv.length) {
        throw new Error(`${INTERNAL_CHILD_FLAG} requires a value.`);
      }

      internalChild = argv[index + 1]!;
      index += 1;
      continue;
    }

    if (arg === ENV_POLICY_FLAG) {
      const value = argv[index + 1];
      if (value !== "development" && value !== "production") {
        throw new Error(
          `${ENV_POLICY_FLAG} requires development or production.`,
        );
      }
      envPolicy = value;
      index += 1;
      continue;
    }

    if (arg === DEV_PROJECT_ROOT_FLAG) {
      const value = argv[index + 1];
      if (value === undefined || value.trim() === "") {
        throw new Error(`${DEV_PROJECT_ROOT_FLAG} requires a value.`);
      }
      devProjectRoot = value;
      index += 1;
      continue;
    }

    if (arg !== STATE_DIR_FLAG) {
      stripped.push(arg);
      continue;
    }

    if (index + 1 >= argv.length) {
      throw new Error(`${STATE_DIR_FLAG} requires a value.`);
    }

    stateDir = argv[index + 1]!;
    index += 1;
  }

  return {
    argv: stripped,
    devProjectRoot,
    envPolicy,
    internalChild: internalChild ?? "",
    stateDir,
  };
}
