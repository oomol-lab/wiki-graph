import { describe, expect, it } from "vitest";

import { createCLISandbox } from "./helpers/cli-sandbox.js";
import {
  readPrompt,
  startMockServices,
  type MockRequest,
} from "./helpers/mock-services.js";
import {
  createSourcedArchive,
  enqueueJob,
  waitForJob,
} from "./helpers/workflow.js";

describe("packed CLI Knowledge Graph job", () => {
  it("uses the WikiSpine, Wikimedia, and LLM protocols through a real worker", async () => {
    const sandbox = await createCLISandbox("knowledge-worker");
    const services = await startMockServices({
      respondToLLM: (request) => respondToKnowledgePrompt(readPrompt(request)),
      respondToWikimedia: () => ({
        results: [
          {
            en: {
              description: "English writer",
              label: "Douglas Adams",
              url: "https://en.wikipedia.org/wiki/Douglas_Adams",
            },
            qid: "Q42",
            zh: { description: null, label: null, url: null },
          },
        ],
      }),
      respondToWikispine: respondToWikispine,
    });

    try {
      await sandbox.setConfig("wikispine", {
        endpoint: `${services.endpoint}/wikispine`,
        provider: "fetch",
        token: "e2e-wikispine-token",
      });
      await sandbox.setConfig("wikimedia", {
        endpoint: `${services.endpoint}/wikimedia`,
        token: "e2e-wikimedia-token",
      });
      const runtimeCheck = await sandbox.runJSON<{
        readonly ok: boolean;
        readonly provider: string;
      }>(["wikg://local/config/wikispine", "test", "--json"]);
      expect(runtimeCheck).toMatchObject({ ok: true, provider: "fetch" });

      const chapter = await createSourcedArchive(sandbox, {
        source: "Douglas Adams wrote novels.",
        title: "Douglas Adams",
      });
      const indexJob = await enqueueJob(
        sandbox,
        chapter.locatedUri,
        "index-fts",
      );
      expect((await waitForJob(sandbox, indexJob.jobId)).state).toBe(
        "succeeded",
      );

      const knowledgeJob = await enqueueJob(
        sandbox,
        chapter.locatedUri,
        "knowledge-graph",
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
      const completed = await waitForJob(sandbox, knowledgeJob.jobId, 90_000);
      expect(completed, completed.errorJSON).toMatchObject({
        state: "succeeded",
        target: "knowledge-graph",
      });

      const entities = await sandbox.runJSON<{
        readonly objects: readonly Record<string, unknown>[];
      }>([`${sandbox.archiveUri}/entity`, "--json"]);
      expect(entities.objects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Douglas Adams",
            uri: "wikg://entity/Q42",
          }),
        ]),
      );
      const inspect = await sandbox.runJSON<{
        readonly coverage: {
          readonly knowledgeGraph: { readonly percent: string };
        };
      }>([sandbox.archiveUri, "inspect", "--json"]);
      expect(inspect.coverage.knowledgeGraph.percent).toBe("100%");

      expect(
        services.requests.some(
          (request) => request.path === "/wikispine/match",
        ),
      ).toBe(true);
      expect(
        services.requests.some(
          (request) => request.path === "/wikimedia/qids:resolve",
        ),
      ).toBe(true);
      expectProtocolBodies(services.requests);
      expectBearerTokens(services.requests);
    } finally {
      await services.close();
    }
  });
});

function respondToWikispine(request: MockRequest): string {
  const body = request.body as { readonly text?: unknown };
  if (typeof body.text !== "string") {
    throw new Error("WikiSpine match request is missing text.");
  }
  if (!body.text.includes("Douglas Adams")) {
    return `${JSON.stringify({ type: "done", stats: { matches: 0 } })}\n`;
  }
  return [
    JSON.stringify({
      match: {
        end: "Douglas Adams".length,
        qids: [{ disambiguation: false, qid: "Q42" }],
        start: 0,
        surface_id: 1,
      },
      type: "match",
    }),
    JSON.stringify({ type: "done", stats: { matches: 1 } }),
    "",
  ].join("\n");
}

function expectProtocolBodies(requests: readonly MockRequest[]): void {
  const match = requests.find(
    (request) =>
      request.path === "/wikispine/match" &&
      typeof request.body === "object" &&
      request.body !== null &&
      "text" in request.body &&
      request.body.text === "Douglas Adams wrote novels.",
  );
  expect(match).toMatchObject({
    body: {
      options: { include_disambiguation: true },
      text: "Douglas Adams wrote novels.",
    },
    method: "POST",
  });
  expect(match?.headers.accept).toBe("application/x-ndjson");

  const wikimedia = requests.find(
    (request) => request.path === "/wikimedia/qids:resolve",
  );
  expect(wikimedia).toMatchObject({
    body: { entities: [{ disambiguation: false, qid: "Q42" }] },
    method: "POST",
  });

  const llm = requests.filter(
    (request) => request.path === "/v1/chat/completions",
  );
  expect(llm.length).toBeGreaterThanOrEqual(2);
  for (const request of llm) {
    expect(request).toMatchObject({
      body: { model: "wiki-graph-e2e", stream: true },
      method: "POST",
    });
  }
}

function respondToKnowledgePrompt(prompt: string): string {
  if (prompt.includes("precomputed Wikidata mention candidates")) {
    return JSON.stringify({
      groups: [
        {
          decisions: [{ candidateId: "c1", decision: "recall", qid: "Q42" }],
          groupId: "g1",
        },
      ],
    });
  }
  if (prompt.includes("Suspicious high-frequency surfaces")) {
    return JSON.stringify({ protectedSurfaces: [{ surfaceId: "s1" }] });
  }
  if (prompt.includes("semantic relations between grounded entity mentions")) {
    return JSON.stringify({ relations: [] });
  }
  throw new Error(`Unexpected Knowledge Graph prompt:\n${prompt}`);
}

function expectBearerTokens(requests: readonly MockRequest[]): void {
  const wikispineRequests = requests.filter((request) =>
    request.path.startsWith("/wikispine/"),
  );
  expect(wikispineRequests.length).toBeGreaterThan(0);
  for (const request of wikispineRequests) {
    expect(request.headers.authorization).toBe("Bearer e2e-wikispine-token");
  }
  const wikimedia = requests.find(
    (request) => request.path === "/wikimedia/qids:resolve",
  );
  expect(wikimedia?.headers.authorization).toBe("Bearer e2e-wikimedia-token");
}
