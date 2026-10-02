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
          {
            en: {
              description: "1979 novel by Douglas Adams",
              label: "The Hitchhiker's Guide to the Galaxy",
              url: "https://en.wikipedia.org/wiki/The_Hitchhiker%27s_Guide_to_the_Galaxy_(novel)",
            },
            qid: "Q25169",
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
        source: "Douglas Adams wrote The Hitchhiker's Guide to the Galaxy.",
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
          expect.objectContaining({
            label: "The Hitchhiker's Guide to the Galaxy",
            uri: "wikg://entity/Q25169",
          }),
        ]),
      );
      const entityEvidence = await sandbox.runJSON<{
        readonly objects: readonly Record<string, unknown>[];
      }>([`${sandbox.archiveUri}/entity/Q42`, "evidence", "--json"]);
      expect(JSON.stringify(entityEvidence.objects)).toContain(
        "Douglas Adams wrote The Hitchhiker's Guide to the Galaxy",
      );
      expect(JSON.stringify(entityEvidence.objects)).toContain("/source#");

      const triples = await sandbox.runJSON<{
        readonly objects: readonly Record<string, unknown>[];
      }>([`${sandbox.archiveUri}/triple`, "--json"]);
      expect(triples.objects).toEqual([
        expect.objectContaining({
          uri: "wikg://triple/Q42/author/Q25169",
        }),
      ]);
      const evidence = await sandbox.runJSON<{
        readonly objects: readonly Record<string, unknown>[];
      }>([
        `${sandbox.archiveUri}/triple/Q42/author/Q25169`,
        "evidence",
        "--json",
      ]);
      expect(JSON.stringify(evidence.objects)).toContain(
        "Douglas Adams wrote The Hitchhiker's Guide to the Galaxy",
      );
      expect(JSON.stringify(evidence.objects)).toContain("/source#");
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
    JSON.stringify({
      match: {
        end:
          body.text.indexOf("The Hitchhiker's Guide to the Galaxy") +
          "The Hitchhiker's Guide to the Galaxy".length,
        qids: [{ disambiguation: false, qid: "Q25169" }],
        start: body.text.indexOf("The Hitchhiker's Guide to the Galaxy"),
        surface_id: 2,
      },
      type: "match",
    }),
    JSON.stringify({ type: "done", stats: { matches: 2 } }),
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
      request.body.text ===
        "Douglas Adams wrote The Hitchhiker's Guide to the Galaxy.",
  );
  expect(match).toMatchObject({
    body: {
      options: { include_disambiguation: true },
      text: "Douglas Adams wrote The Hitchhiker's Guide to the Galaxy.",
    },
    method: "POST",
  });
  expect(match?.headers.accept).toBe("application/x-ndjson");

  const wikimedia = requests.find(
    (request) => request.path === "/wikimedia/qids:resolve",
  );
  expect(wikimedia).toMatchObject({
    method: "POST",
  });
  expect(
    (wikimedia?.body as { readonly entities?: readonly unknown[] }).entities,
  ).toEqual(
    expect.arrayContaining([
      { disambiguation: false, qid: "Q42" },
      { disambiguation: false, qid: "Q25169" },
    ]),
  );

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
    const candidateGroups = readCandidateGroups(prompt);
    return JSON.stringify({
      groups: candidateGroups.map((group) => ({
        decisions: group.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          decision: "recall",
          qid: candidate.entityOptions[0]!.qid,
        })),
        groupId: group.groupId,
      })),
    });
  }
  if (prompt.includes("Suspicious high-frequency surfaces")) {
    const surfaceIds = [...prompt.matchAll(/"surfaceId": "(s\d+)"/gu)].map(
      (match) => match[1]!,
    );
    return JSON.stringify({
      protectedSurfaces: [...new Set(surfaceIds)].map((surfaceId) => ({
        surfaceId,
      })),
    });
  }
  if (prompt.includes("semantic relations between grounded entity mentions")) {
    const sourceMentionId = readMentionId(prompt, "Q42");
    const targetMentionId = readMentionId(prompt, "Q25169");
    return JSON.stringify({
      relations: [
        {
          confidence: 0.99,
          evidence: {
            quote: "Douglas Adams wrote The Hitchhiker's Guide to the Galaxy",
            sentence_id: "S1",
          },
          predicate: "author",
          sourceMentionId,
          targetMentionId,
        },
      ],
    });
  }
  throw new Error(`Unexpected Knowledge Graph prompt:\n${prompt}`);
}

function readCandidateGroups(prompt: string): readonly CandidateGroup[] {
  const lines = prompt
    .split("\n")
    .filter((value) => value.startsWith('{"candidates":'));
  if (lines.length === 0) {
    throw new Error(`Policy prompt is missing candidate groups:\n${prompt}`);
  }
  return lines.map((line) => JSON.parse(line) as CandidateGroup);
}

interface CandidateGroup {
  readonly candidates: readonly {
    readonly candidateId: string;
    readonly entityOptions: readonly { readonly qid: string }[];
  }[];
  readonly groupId: string;
}

function readMentionId(prompt: string, qid: string): string {
  const match = new RegExp(`<mention id="([^"]+)" qid="${qid}">`, "u").exec(
    prompt,
  );
  if (match?.[1] === undefined) {
    throw new Error(`Relation prompt is missing a ${qid} mention:\n${prompt}`);
  }
  return match[1];
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
