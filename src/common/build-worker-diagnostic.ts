import { appendFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";

import { resolveWikiGraphStateDirectoryPath } from "./wiki-graph-dir.js";

export function appendBuildWorkerDiagnosticLog(
  event: Record<string, unknown> & { readonly event: string },
): void {
  try {
    mkdirSync(getBuildQueueStateDirectoryPath(), { recursive: true });
    appendFileSync(
      getBuildWorkerLogPath(),
      `${JSON.stringify({
        at: Date.now(),
        pid: process.pid,
        ...event,
      })}\n`,
      "utf8",
    );
  } catch {
    return;
  }
}

export function getBuildWorkerMemorySnapshot(): {
  readonly arrayBuffers: number;
  readonly external: number;
  readonly heapTotal: number;
  readonly heapUsed: number;
  readonly rss: number;
} {
  const memory = process.memoryUsage();

  return {
    arrayBuffers: memory.arrayBuffers,
    external: memory.external,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    rss: memory.rss,
  };
}

function getBuildWorkerLogPath(): string {
  return join(getBuildQueueStateDirectoryPath(), "build-worker.ndjson");
}

function getBuildQueueStateDirectoryPath(): string {
  const stateDirectoryPath = process.env.WIKIGRAPH_STATE_DIR;

  if (stateDirectoryPath !== undefined && stateDirectoryPath.trim() !== "") {
    return resolve(stateDirectoryPath);
  }

  return resolveWikiGraphStateDirectoryPath();
}
