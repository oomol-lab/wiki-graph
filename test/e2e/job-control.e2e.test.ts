import { describe, expect, it } from "vitest";

import { createCLISandbox } from "./helpers/cli-sandbox.js";
import { readPrompt, startMockServices } from "./helpers/mock-services.js";
import {
  createSourcedArchive,
  enqueueJob,
  parseJSONL,
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
      const providerRequest = services.requests.find(
        (request) => request.path === "/v1/chat/completions",
      );
      expect(providerRequest).toBeDefined();
      await expect(
        withTimeout(providerRequest!.connectionClosed, 5_000),
      ).resolves.toBeUndefined();

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

  it("reports provider failures through status and replayed job events", async () => {
    const sandbox = await createCLISandbox("job-failure");
    const services = await startMockServices({
      respondToLLM: () => ({
        body: { error: { message: "invalid e2e credentials" } },
        status: 401,
      }),
    });

    try {
      const chapter = await createSourcedArchive(sandbox, {
        source: "Arthur decided to leave Earth.",
        title: "Failed departure",
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

      const failed = await waitForJob(sandbox, job.jobId);
      expect(failed.state).toBe("failed");
      expect(failed.errorJSON).toContain("invalid e2e credentials");

      const humanStatus = await sandbox.run([`wikg://local/job/${job.jobId}`]);
      expect(humanStatus.exitCode, humanStatus.stderr).toBe(0);
      expect(humanStatus.stdout).toContain("State: failed");
      expect(humanStatus.stdout).toContain("invalid e2e credentials");

      const watch = await sandbox.run([
        `wikg://local/job/${job.jobId}`,
        "watch",
        "--jsonl",
        "--from",
        "beginning",
      ]);
      expect(watch.exitCode, watch.stderr).toBe(0);
      const events = parseJSONL(watch.stdout);
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining(["started", "failed"]),
      );
    } finally {
      await services.close();
    }
  });

  it("retries a throttled provider response and completes the job", async () => {
    const sandbox = await createCLISandbox("job-retry");
    let requestCount = 0;
    const services = await startMockServices({
      respondToLLM: (request) => {
        requestCount += 1;
        if (requestCount === 1) {
          return {
            body: { error: { message: "e2e rate limit" } },
            status: 429,
          };
        }
        const prompt = readPrompt(request);
        if (prompt.includes("importance_annotations")) {
          return JSON.stringify({
            chunks: [],
            importance_annotations: [],
            links: [],
          });
        }
        return JSON.stringify({
          chunks: [
            {
              content: "Arthur leaves Earth.",
              evidence: [
                {
                  quote: "Arthur decided to leave Earth.",
                  sentence_id: "S1",
                },
              ],
              label: "Departure",
              retention: "focused",
              temp_id: "A",
            },
          ],
          fragment_summary: "Arthur leaves Earth.",
          links: [],
        });
      },
    });

    try {
      const chapter = await createSourcedArchive(sandbox, {
        source: "Arthur decided to leave Earth.",
        title: "Retried departure",
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

      const completed = await waitForJob(sandbox, job.jobId, 90_000);
      expect(completed, completed.errorJSON).toMatchObject({
        state: "succeeded",
        target: "reading-graph",
      });
      expect(requestCount).toBeGreaterThanOrEqual(2);
    } finally {
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolvePromise, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Operation exceeded ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
