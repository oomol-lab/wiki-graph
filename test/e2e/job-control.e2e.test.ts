import { describe, expect, it } from "vitest";

import { createCLISandbox } from "./helpers/cli-sandbox.js";
import { startMockServices } from "./helpers/mock-services.js";
import {
  createSourcedArchive,
  enqueueJob,
  waitForJob,
} from "./helpers/workflow.js";

describe("packed CLI job control", () => {
  it("cancels a running provider request and persists the terminal state", async () => {
    const sandbox = await createCLISandbox("job-cancel");
    const pendingResponse = deferred<string>();
    const services = await startMockServices({
      respondToLLM: async () => await pendingResponse.promise,
    });

    try {
      const chapter = await createSourcedArchive(sandbox, {
        source: "Arthur decided to leave Earth. He carried a towel.",
        title: "Cancelable departure",
      });
      const indexJob = await enqueueJob(
        sandbox,
        chapter.locatedUri,
        "index-fts",
      );
      expect((await waitForJob(sandbox, indexJob.jobId)).state).toBe(
        "succeeded",
      );
      const job = await enqueueJob(
        sandbox,
        chapter.locatedUri,
        "reading-graph",
        {
          acceptCost: true,
          llm: {
            apiKey: "e2e-key",
            baseURL: `${services.endpoint}/v1`,
            model: "wiki-graph-e2e",
            provider: "openai-compatible",
          },
        },
      );

      await waitUntil(
        () =>
          services.requests.some(
            (request) => request.path === "/v1/chat/completions",
          ),
        30_000,
      );
      const canceled = await sandbox.run([
        `wikg://local/job/${job.jobId}`,
        "cancel",
      ]);
      expect(canceled.exitCode, canceled.stderr).toBe(0);
      expect(canceled.stdout).toContain("canceling");
      expect((await waitForJob(sandbox, job.jobId)).state).toBe("canceled");

      const inspect = await sandbox.runJSON<{
        readonly coverage: {
          readonly readingGraph: { readonly coveredChapters: number };
        };
      }>([sandbox.archiveUri, "inspect", "--json"]);
      expect(inspect.coverage.readingGraph.coveredChapters).toBe(0);
    } finally {
      pendingResponse.resolve(JSON.stringify({ chunks: [], links: [] }));
      await services.close();
    }
  });
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((resolvePromise) => {
      resolve = resolvePromise;
    }),
    resolve: (value) => resolve(value),
  };
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}
