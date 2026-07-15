import { describe, expect, it, vi } from "vitest";

import { DirectoryDocument } from "../../packages/core/src/document/index.js";
import {
  buildChapterKnowledgeGraphArtifact,
  clearChapterKnowledgeGraph,
  commitChapterKnowledgeGraphArtifact,
  createEnrichmentProgressReporter,
  generateChapterKnowledgeGraphArtifactFromSnapshot,
  groundWikimatchCandidates,
} from "../../packages/core/src/facade/index.js";
import type { GuaranteedRequest } from "../../packages/core/src/guaranteed/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/knowledge-graph-build", () => {
  it("generates knowledge graph artifacts from a snapshot without a document session", async () => {
    await withTempDir("wikigraph-kg-snapshot-", async (path) => {
      const artifact = await generateChapterKnowledgeGraphArtifactFromSnapshot(
        1,
        {
          details: {
            chapterId: 1,
            childCount: 0,
            depth: 0,
            documentOrder: 1,
            fragmentCount: 0,
            graphReady: false,
            hasSummary: false,
            stage: "sourced",
            title: null,
            tocPath: [],
            words: 0,
          },
          fragments: [],
        },
        {
          policyPrompt: "Recall entities.",
          request: () => {
            throw new Error("LLM should not be called for empty snapshots.");
          },
          workspacePath: path,
        },
      );

      expect(artifact).toMatchObject({
        chapterId: 1,
        workspacePath: `${path}/knowledge-graph/chapter-1`,
      });
    });
  });

  it("rejects knowledge graph snapshots for a different chapter", async () => {
    await expect(
      generateChapterKnowledgeGraphArtifactFromSnapshot(
        2,
        {
          details: {
            chapterId: 1,
            childCount: 0,
            depth: 0,
            documentOrder: 1,
            fragmentCount: 0,
            graphReady: false,
            hasSummary: false,
            stage: "sourced",
            title: null,
            tocPath: [],
            words: 0,
          },
          fragments: [],
        },
        {
          policyPrompt: "Recall entities.",
          request: () => Promise.resolve("{}"),
          workspacePath: "",
        },
      ),
    ).rejects.toThrow("belongs to chapter 1, not chapter 2");
  });

  it("reports enrichment progress across resolver subphases", async () => {
    const phases: unknown[] = [];
    let stopChecks = 0;
    const reporter = createEnrichmentProgressReporter({
      throwIfStopped: () => {
        stopChecks += 1;
        return Promise.resolve();
      },
      updatePhase: (input) => {
        phases.push(input);
        return Promise.resolve();
      },
    });

    await reporter({ detail: "entity", done: 50, total: 100 });
    await reporter({ detail: "page", done: 10, total: 20 });
    await reporter({ detail: "disambiguation-page", done: 8, total: 12 });
    await reporter({ detail: "linked-page", done: 40, total: 120 });
    await reporter({ detail: "qid", done: 75, total: 100 });

    expect(stopChecks).toBe(5);
    expect(phases).toStrictEqual([
      {
        done: 50,
        phase: "enrichment",
        phaseDetail: "entity",
        total: 100,
        unit: "record",
      },
      {
        done: 10,
        phase: "enrichment",
        phaseDetail: "page",
        total: 20,
        unit: "page",
      },
      {
        done: 8,
        phase: "enrichment",
        phaseDetail: "disambiguation",
        total: 12,
        unit: "page",
      },
      {
        done: 40,
        phase: "enrichment",
        phaseDetail: "linked",
        total: 120,
        unit: "page",
      },
      {
        done: 75,
        phase: "enrichment",
        total: 100,
        unit: "qid",
      },
    ]);
  });

  it("grounds oversized candidate pages without narrowing", async () => {
    const updates: unknown[] = [];
    const request = vi.fn<GuaranteedRequest>().mockImplementation((messages) =>
      Promise.resolve(
        JSON.stringify({
          groups: [
            {
              decisions: [
                readUserPrompt(messages).includes('"qid":"Q40"')
                  ? {
                      candidateId: "c1",
                      decision: "recall",
                      qid: "Q40",
                    }
                  : {
                      candidateId: "c1",
                      decision: "continue",
                    },
              ],
              groupId: "g1",
            },
          ],
        }),
      ),
    );

    const mentions = await groundWikimatchCandidates({
      candidates: [
        {
          id: "c1",
          qidOptions: [
            {
              disambiguation: {
                checkedAt: "2026-06-27T00:00:00.000Z",
                disambiguationQid: "Q1",
                linkedQids: Array.from({ length: 40 }, (_value, index) => ({
                  qid: `Q${index + 1}`,
                  title: `Option ${index + 1}`,
                })),
                pages: [],
              },
              isDisambiguation: true,
              label: "舰队",
              qid: "Q1",
            },
          ],
          range: { end: 2, start: 0 },
          surface: "舰队",
        },
      ],
      policyPrompt: "召回历史叙事中的实体。",
      progressTracker: {
        throwIfStopped: () => Promise.resolve(),
        updatePhase: (input) => {
          updates.push(input);
          return Promise.resolve();
        },
      },
      request,
      text: "舰队发动攻击。",
    });

    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[0]?.[0][1]?.content).toContain(
      '"hasMoreOptions":true',
    );
    expect(request.mock.calls[0]?.[0][1]?.content).not.toContain('"qid":"Q6"');
    expect(mentions).toStrictEqual([
      {
        candidateId: "c1",
        qid: "Q40",
        range: { end: 2, start: 0 },
        surface: "舰队",
      },
    ]);
    expect(updates).not.toContainEqual(
      expect.objectContaining({ phase: "narrowing" }),
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        phase: "grounding",
        phaseDetail: "efficiency qid/mention=40.0 qids=40 mentions=1 pages=4",
      }),
    );
  });

  it("does not repeat shown qids when recall history changes paging order", async () => {
    const request = vi
      .fn<GuaranteedRequest>()
      .mockImplementation((messages) => {
        const prompt = readUserPrompt(messages);
        const groups = readCandidateGroups(prompt);

        if (prompt.includes('"candidateId":"history"')) {
          return Promise.resolve(
            JSON.stringify({
              groups: groups.map((group) => ({
                decisions: group.candidates.map((candidate) =>
                  candidate.candidateId === "history"
                    ? {
                        candidateId: "history",
                        decision: "recall",
                        qid: "Q2",
                      }
                    : {
                        candidateId: candidate.candidateId,
                        decision: "continue",
                      },
                ),
                groupId: group.groupId,
              })),
            }),
          );
        }

        if (prompt.includes('"qid":"Q41"')) {
          return Promise.resolve(
            JSON.stringify({
              groups: groups.map((group) => ({
                decisions: group.candidates.map((candidate) => ({
                  candidateId: candidate.candidateId,
                  decision: "recall",
                  qid: "Q41",
                })),
                groupId: group.groupId,
              })),
            }),
          );
        }

        return Promise.resolve(
          JSON.stringify({
            groups: groups.map((group) => ({
              decisions: group.candidates.map((candidate) => ({
                candidateId: candidate.candidateId,
                decision: "continue",
              })),
              groupId: group.groupId,
            })),
          }),
        );
      });

    const mentions = await groundWikimatchCandidates({
      candidates: [
        {
          id: "history",
          qidOptions: Array.from({ length: 31 }, (_value, index) => ({
            label: `History ${index + 1}`,
            qid: `Q${index + 1}`,
          })),
          range: { end: 2, start: 0 },
          surface: "舰队",
        },
        {
          id: "paged",
          qidOptions: Array.from({ length: 41 }, (_value, index) => ({
            label: `Option ${index + 1}`,
            qid: `Q${index + 1}`,
          })),
          range: { end: 5, start: 3 },
          surface: "舰队",
        },
      ],
      policyPrompt: "召回历史叙事中的实体。",
      request,
      text: "舰队 舰队",
    });

    const secondPrompt =
      request.mock.calls
        .map((call) => readUserPrompt(call[0]))
        .find((prompt) => prompt.includes('"qid":"Q41"')) ?? "";

    expect(secondPrompt).not.toContain('"qid":"Q2"');
    expect(secondPrompt).toContain('"qid":"Q41"');
    expect(mentions).toEqual(
      expect.arrayContaining([
        {
          candidateId: "history",
          qid: "Q2",
          range: { end: 2, start: 0 },
          surface: "舰队",
        },
        {
          candidateId: "paged",
          qid: "Q41",
          range: { end: 5, start: 3 },
          surface: "舰队",
        },
      ]),
    );
  });

  it("uses slower continued pages after strong surface prior", async () => {
    const request = vi
      .fn<GuaranteedRequest>()
      .mockImplementation((messages) => {
        const prompt = readUserPrompt(messages);
        const groups = readCandidateGroups(prompt);

        return Promise.resolve(
          JSON.stringify({
            groups: groups.map((group) => ({
              decisions: group.candidates.map((candidate) => {
                if (prompt.includes('"qid":"Q6"')) {
                  return {
                    candidateId: candidate.candidateId,
                    decision: "recall",
                    qid: "Q6",
                  };
                }

                return candidate.candidateId === "c4"
                  ? {
                      candidateId: "c4",
                      decision: "continue",
                    }
                  : {
                      candidateId: candidate.candidateId,
                      decision: "never_recall",
                    };
              }),
              groupId: group.groupId,
            })),
          }),
        );
      });

    await groundWikimatchCandidates({
      candidates: [
        {
          id: "c1",
          qidOptions: [{ qid: "Q1" }],
          range: { end: 2, start: 0 },
          surface: "舰队",
        },
        {
          id: "c2",
          qidOptions: [{ qid: "Q1" }],
          range: { end: 5, start: 3 },
          surface: "舰队",
        },
        {
          id: "c3",
          qidOptions: [{ qid: "Q1" }],
          range: { end: 8, start: 6 },
          surface: "舰队",
        },
        {
          id: "c4",
          qidOptions: Array.from({ length: 12 }, (_value, index) => ({
            label: `Option ${index + 1}`,
            qid: `Q${index + 1}`,
          })),
          range: { end: 11, start: 9 },
          surface: "舰队",
        },
      ],
      policyPrompt: "召回历史叙事中的实体。",
      request,
      text: "舰队 舰队 舰队 舰队",
    });

    const prompt = readUserPrompt(request.mock.calls[1]![0]);

    expect(prompt).toContain('"candidateId":"c4"');
    expect(prompt).toContain('"qid":"Q10"');
    expect(prompt).not.toContain('"qid":"Q11"');
  });

  it("keeps non-lazy grounding requests sequential", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const request = vi
      .fn<GuaranteedRequest>()
      .mockImplementation(async (messages) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        await wait(0);
        activeRequests -= 1;
        const groups = readCandidateGroups(readUserPrompt(messages));

        return JSON.stringify({
          groups: groups.map((group) => ({
            decisions: group.candidates.map((candidate) => ({
              candidateId: candidate.candidateId,
              decision: "never_recall",
            })),
            groupId: group.groupId,
          })),
        });
      });

    await groundWikimatchCandidates({
      candidates: Array.from({ length: 11 }, (_value, index) => ({
        id: `c${index + 1}`,
        qidOptions: Array.from({ length: 30 }, (_value, optionIndex) => ({
          label: `Option ${optionIndex + 1}`,
          qid: `Q${index * 30 + optionIndex + 1}`,
        })),
        range: { end: index * 3 + 1, start: index * 3 },
        surface: "舰",
      })),
      policyPrompt: "召回历史叙事中的实体。",
      request,
      text: "舰 队 舰 队 舰 队 舰 队",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(maxActiveRequests).toBe(1);
  });

  it("commits chapter mention evidence from JSONL artifacts", async () => {
    await withTempDir("wikigraph-knowledge-graph-build-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.serials.createWithId(1);
        });

        const artifact = await buildChapterKnowledgeGraphArtifact(1, {
          mentionLinks: [
            {
              confidence: 0.8,
              evidenceSentenceIds: [[1, 10]],
              id: "l1",
              predicate: "discusses",
              sourceMentionId: "m1",
              targetMentionId: "m2",
            },
          ],
          mentions: [
            {
              chapterId: 1,
              confidence: 0.95,
              id: "m1",
              qid: "Q205194",
              rangeEnd: 2,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "恩典",
            },
            {
              chapterId: 1,
              id: "m2",
              qid: "Q9476",
              rangeEnd: 7,
              rangeStart: 3,
              sentenceIndex: 0,
              surface: "自由意志",
            },
          ],
          parameter: {
            language: "zh",
            prompt: "只保留神学实体",
          },
          workspacePath: `${path}/workspace`,
        });

        await commitChapterKnowledgeGraphArtifact(document, artifact);

        const serial = await document.serials.getById(1);
        expect(serial?.knowledgeGraphReady).toBe(true);
        expect(serial?.knowledgeGraphParameterHash).toBeDefined();
        await expect(
          document.graphBuildParameters.getByHash(
            serial!.knowledgeGraphParameterHash!,
          ),
        ).resolves.toMatchObject({
          language: "zh",
          prompt: "只保留神学实体",
        });
        expect(await document.mentions.listByChapter(1)).toHaveLength(2);
        expect(await document.mentionLinks.listByChapter(1)).toStrictEqual([
          {
            confidence: 0.8,
            evidenceSentenceIds: [[1, 10]],
            id: "l1",
            predicate: "discusses",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
        ]);

        const replacementArtifact = await buildChapterKnowledgeGraphArtifact(
          1,
          {
            mentionLinks: [],
            mentions: [
              {
                chapterId: 1,
                id: "m3",
                qid: "Q162593",
                rangeEnd: 3,
                rangeStart: 0,
                surface: "伯拉纠",
              },
            ],
            workspacePath: `${path}/workspace`,
          },
        );

        await expect(
          commitChapterKnowledgeGraphArtifact(document, replacementArtifact),
        ).rejects.toThrow(
          "Refusing to replace chapter 1 knowledge graph with an artifact that contains no mention links.",
        );

        expect(await document.mentions.listByChapter(1)).toHaveLength(2);
        expect(await document.mentionLinks.listByChapter(1)).toStrictEqual([
          {
            confidence: 0.8,
            evidenceSentenceIds: [[1, 10]],
            id: "l1",
            predicate: "discusses",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
        ]);

        await clearChapterKnowledgeGraph(document, 1);

        expect((await document.serials.getById(1))?.knowledgeGraphReady).toBe(
          false,
        );
        expect(
          (await document.serials.getById(1))?.knowledgeGraphParameterHash,
        ).toBeUndefined();
        await expect(
          document.graphBuildParameters.getByHash(
            serial!.knowledgeGraphParameterHash!,
          ),
        ).resolves.toBeUndefined();
        expect(await document.mentions.listByChapter(1)).toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("marks knowledge graph ready for empty first-pass artifacts", async () => {
    await withTempDir("wikigraph-knowledge-graph-build-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        const artifact = await buildChapterKnowledgeGraphArtifact(1, {
          mentionLinks: [],
          mentions: [],
          workspacePath: `${path}/workspace`,
        });

        await commitChapterKnowledgeGraphArtifact(document, artifact);

        expect(await document.mentions.listByChapter(1)).toStrictEqual([]);
        expect(await document.mentionLinks.listByChapter(1)).toStrictEqual([]);
        expect((await document.serials.getById(1))?.knowledgeGraphReady).toBe(
          true,
        );
      } finally {
        await document.release();
      }
    });
  });

  it("rejects mention links that point outside the artifact", async () => {
    await withTempDir("wikigraph-knowledge-graph-build-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        const artifact = await buildChapterKnowledgeGraphArtifact(1, {
          mentionLinks: [
            {
              evidenceSentenceIds: [[1, 10]],
              id: "l1",
              predicate: "mentions",
              sourceMentionId: "m1",
              targetMentionId: "missing",
            },
          ],
          mentions: [
            {
              chapterId: 1,
              id: "m1",
              qid: "Q1",
              rangeEnd: 1,
              rangeStart: 0,
              surface: "A",
            },
          ],
          workspacePath: `${path}/workspace`,
        });

        await expect(
          commitChapterKnowledgeGraphArtifact(document, artifact),
        ).rejects.toThrow(
          "Mention link l1 references unknown target mention missing.",
        );
      } finally {
        await document.release();
      }
    });
  });

  it("rejects negative mention sentence indexes", async () => {
    await withTempDir("wikigraph-knowledge-graph-build-", async (path) => {
      await expect(
        buildChapterKnowledgeGraphArtifact(1, {
          mentionLinks: [],
          mentions: [
            {
              chapterId: 1,
              id: "m1",
              qid: "Q1",
              rangeEnd: 1,
              rangeStart: 0,
              sentenceIndex: -1,
              surface: "A",
            },
          ],
          workspacePath: `${path}/workspace`,
        }),
      ).rejects.toThrow("sentenceIndex");
    });
  });
});

function readUserPrompt(messages: Parameters<GuaranteedRequest>[0]): string {
  const content = messages[1]?.content;

  return typeof content === "string" ? content : "";
}

function readCandidateGroups(prompt: string): Array<{
  readonly candidates: Array<{ readonly candidateId: string }>;
  readonly groupId: string;
}> {
  const match =
    /Candidate groups:\n(?<groups>[\s\S]+?)\n\nReturn this JSON shape:/u.exec(
      prompt,
    );

  const groupsJson = match?.groups?.["groups"];

  if (groupsJson === undefined) {
    throw new Error("Missing candidate groups in prompt.");
  }

  return groupsJson
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(
      (line) =>
        JSON.parse(line) as {
          readonly candidates: Array<{ readonly candidateId: string }>;
          readonly groupId: string;
        },
    ) as Array<{
    readonly candidates: Array<{ readonly candidateId: string }>;
    readonly groupId: string;
  }>;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
