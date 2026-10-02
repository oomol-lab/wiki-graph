import { describe, expect, it } from "vitest";

import { assertSucceeded, createCLISandbox } from "./helpers/cli-sandbox.js";
import { startMockServices } from "./helpers/mock-services.js";
import {
  createSourcedArchive,
  enqueueJob,
  waitForJob,
} from "./helpers/workflow.js";

describe("packed CLI Reading Graph and Summary jobs", () => {
  it("builds generated artifacts through a real worker and protocol mock", async () => {
    const sandbox = await createCLISandbox("reading-worker");
    const respondToLLM = createReadingResponder();
    const services = await startMockServices({
      respondToLLM,
    });

    try {
      const source = "Arthur decided to leave Earth. He carried a towel.";
      const chapter = await createSourcedArchive(sandbox, {
        source,
        title: "Departure",
      });
      const indexJob = await enqueueJob(
        sandbox,
        chapter.locatedUri,
        "index-fts",
      );
      expect((await waitForJob(sandbox, indexJob.jobId)).state).toBe(
        "succeeded",
      );

      const readingJob = await enqueueJob(
        sandbox,
        chapter.locatedUri,
        "reading-summary",
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
      const completed = await waitForJob(sandbox, readingJob.jobId, 90_000);
      expect(completed, completed.errorJSON).toMatchObject({
        state: "succeeded",
        target: "reading-summary",
      });

      const summary = await sandbox.run([`${chapter.locatedUri}/summary`]);
      assertSucceeded(["chapter", "summary"], summary);
      expect(summary.stdout).toContain("Arthur decided to leave Earth.");

      const chunks = await sandbox.runJSON<{
        readonly objects: readonly Record<string, unknown>[];
      }>([`${chapter.locatedUri}/chunk`, "--json"]);
      expect(chunks.objects.length).toBeGreaterThan(0);

      const inspect = await sandbox.runJSON<{
        readonly coverage: {
          readonly readingGraph: { readonly percent: string };
          readonly summary: { readonly percent: string };
        };
      }>([sandbox.archiveUri, "inspect", "--json"]);
      expect(inspect.coverage.readingGraph.percent).toBe("100%");
      expect(inspect.coverage.summary.percent).toBe("100%");

      const exported = await sandbox.run([
        sandbox.archiveUri,
        "export",
        "--output-format",
        "markdown",
      ]);
      assertSucceeded(["archive", "export"], exported);
      expect(exported.stdout).toContain("Arthur decided to leave Earth.");
      expect(
        services.requests.filter(
          (request) => request.path === "/v1/chat/completions",
        ).length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      await services.close();
    }
  });
});

function createReadingResponder(): () => string {
  const responses = [
    JSON.stringify({
      chunks: [
        {
          content: "Arthur decides to leave Earth with a towel.",
          evidence: [
            {
              quote: "Arthur decided to leave Earth.",
              sentence_id: "S1",
            },
          ],
          label: "Departure decision",
          retention: "focused",
          temp_id: "A",
        },
      ],
      fragment_summary: "Arthur leaves Earth with a towel.",
      links: [],
    }),
    JSON.stringify({
      chunks: [],
      importance_annotations: [],
      links: [],
    }),
  ];
  return () => {
    const response = responses.shift();
    if (response === undefined) {
      throw new Error("Reading pipeline made more than two LLM requests.");
    }
    return response;
  };
}
