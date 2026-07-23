#!/usr/bin/env node

import { runQueueWorker } from "../commands/index.js";

async function main(): Promise<void> {
  if (process.env.WIKIGRAPH_INTERNAL_CHILD !== "queue-worker") {
    process.stderr.write("This Wiki Graph worker entry is internal.\n");
    process.exitCode = 1;
    return;
  }

  await runQueueWorker();
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
