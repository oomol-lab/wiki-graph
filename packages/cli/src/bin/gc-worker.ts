#!/usr/bin/env node

import { tryRunWikiGraphGc } from "wiki-graph-core/gc";

import { formatCLIJSON } from "../support/index.js";

async function main(): Promise<void> {
  if (process.env.WIKIGRAPH_INTERNAL_CHILD !== "gc-worker") {
    process.stderr.write("This Wiki Graph worker entry is internal.\n");
    process.exitCode = 1;
    return;
  }

  const args = parseGcWorkerArguments(process.argv.slice(2));
  process.stdout.write(
    formatCLIJSON(
      await tryRunWikiGraphGc({
        dryRun: args.dryRun,
        force: args.force,
      }),
    ),
  );
}

function parseGcWorkerArguments(argv: readonly string[]): {
  readonly dryRun: boolean;
  readonly force: boolean;
} {
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
  };
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
