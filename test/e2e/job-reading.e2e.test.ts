import { describe, expect, it } from "vitest";

import { assertSucceeded, createCLISandbox } from "./helpers/cli-sandbox.js";
import { startMockServices } from "./helpers/mock-services.js";
import {
  createSourcedArchive,
  enqueueJob,
  parseJSONL,
  waitForJob,
} from "./helpers/workflow.js";

describe("packed CLI Reading Graph and Summary jobs", () => {
  it("builds generated artifacts through a real worker and protocol mock", async () => {
    const sandbox = await createCLISandbox("reading-worker");
    const responder = createReadingResponder();
    const services = await startMockServices({
      respondToLLM: responder.respond,
    });

    try {
      const source =
        "Arthur decided to leave Earth. He carried a towel for the journey.";
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
      await waitUntil(
        () =>
          services.requests.some(
            (request) => request.path === "/v1/chat/completions",
          ),
        30_000,
      );
      const liveWatch = sandbox.run(
        [
          `wikg://local/job/${readingJob.jobId}`,
          "watch",
          "--jsonl",
          "--from",
          "now",
        ],
        { timeoutMs: 90_000 },
      );
      await delay(100);
      responder.releaseFirst();
      const completed = await waitForJob(sandbox, readingJob.jobId, 90_000);
      expect(completed, completed.errorJSON).toMatchObject({
        state: "succeeded",
        target: "reading-summary",
      });
      const liveEvents = parseJSONL((await liveWatch).stdout);
      expect(liveEvents.at(-1)).toMatchObject({ type: "succeeded" });
      expect(liveEvents.some((event) => event.type === "status_snapshot")).toBe(
        true,
      );

      const summary = await sandbox.run([`${chapter.locatedUri}/summary`]);
      assertSucceeded(["chapter", "summary"], summary);
      expect(summary.stdout).toContain("Arthur decided to leave Earth.");

      const chunks = await sandbox.runJSON<{
        readonly objects: readonly {
          readonly label: string;
          readonly uri: string;
        }[];
      }>([`${chapter.locatedUri}/chunk`, "--json"]);
      expect(chunks.objects).toHaveLength(2);
      const departure = chunks.objects.find(
        (chunk) => chunk.label === "Departure decision",
      );
      const towel = chunks.objects.find(
        (chunk) => chunk.label === "Travel preparation",
      );
      expect(departure).toBeDefined();
      expect(towel).toBeDefined();

      const evidence = await sandbox.runJSON<{
        readonly objects: readonly Record<string, unknown>[];
      }>([
        locateObjectUri(sandbox.archiveUri, departure!.uri),
        "evidence",
        "--json",
      ]);
      expect(JSON.stringify(evidence.objects)).toContain(
        "Arthur decided to leave Earth",
      );

      const related = await sandbox.runJSON<{
        readonly objects: readonly { readonly uri: string }[];
      }>([
        locateObjectUri(sandbox.archiveUri, departure!.uri),
        "related",
        "--json",
      ]);
      expect(related.objects.map((item) => item.uri)).toContain(towel!.uri);

      const query = await sandbox.runJSON<{
        readonly objects: readonly { readonly uri: string }[];
      }>([`${sandbox.archiveUri}/chunk`, "--query", "towel", "--json"]);
      expect(query.objects.map((item) => item.uri)).toContain(towel!.uri);

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

function createReadingResponder(): {
  readonly releaseFirst: () => void;
  readonly respond: () => Promise<string> | string;
} {
  const first = deferred(
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
        {
          content: "Arthur carries a towel for the journey.",
          evidence: [
            {
              quote: "He carried a towel for the journey.",
              sentence_id: "S2",
            },
          ],
          label: "Travel preparation",
          retention: "focused",
          temp_id: "B",
        },
      ],
      fragment_summary: "Arthur leaves Earth with a towel.",
      links: [{ from: "A", strength: "strong", to: "B" }],
    }),
  );
  const responses = [
    JSON.stringify({
      chunks: [],
      importance_annotations: [],
      links: [],
    }),
  ];
  let firstCall = true;
  return {
    releaseFirst: first.resolve,
    respond: () => {
      if (firstCall) {
        firstCall = false;
        return first.promise;
      }
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("Reading pipeline made more than two LLM requests.");
      }
      return response;
    },
  };
}

function deferred(value: string): {
  readonly promise: Promise<string>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  return {
    promise: new Promise<string>((resolvePromise) => {
      resolve = () => resolvePromise(value);
    }),
    resolve: () => resolve(),
  };
}

function locateObjectUri(archiveUri: string, objectUri: string): string {
  return `${archiveUri}/${objectUri.slice("wikg://".length)}`;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}
