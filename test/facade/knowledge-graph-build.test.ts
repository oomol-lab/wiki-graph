import { describe, expect, it, vi } from "vitest";

import { DirectoryDocument } from "../../src/document/index.js";
import {
  buildChapterKnowledgeGraphArtifact,
  clearChapterKnowledgeGraph,
  commitChapterKnowledgeGraphArtifact,
  createEnrichmentProgressReporter,
  groundWikimatchCandidates,
} from "../../src/facade/index.js";
import type { GuaranteedRequest } from "../../src/guaranteed/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("facade/knowledge-graph-build", () => {
  it("reports enrichment progress as one qid counter", async () => {
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
    await reporter({ detail: "qid", done: 75, total: 100 });

    expect(stopChecks).toBe(3);
    expect(phases).toStrictEqual([
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
    const request = vi
      .fn<GuaranteedRequest>()
      .mockResolvedValueOnce(
        JSON.stringify({
          groups: [
            {
              decisions: [
                {
                  candidateId: "c1",
                  decision: "continue",
                },
              ],
              groupId: "g1",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          groups: [
            {
              decisions: [
                {
                  candidateId: "c1",
                  decision: "recall",
                  qid: "Q40",
                },
              ],
              groupId: "g1",
            },
          ],
        }),
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

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0][1]?.content).toContain(
      '"hasMoreOptions": true',
    );
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
  });

  it("does not repeat shown qids when recall history changes paging order", async () => {
    const request = vi
      .fn<GuaranteedRequest>()
      .mockImplementation((messages) => {
        const prompt = readUserPrompt(messages);

        if (prompt.includes('"candidateId": "history"')) {
          return Promise.resolve(
            JSON.stringify({
              groups: [
                {
                  decisions: [
                    {
                      candidateId: "history",
                      decision: "recall",
                      qid: "Q2",
                    },
                  ],
                  groupId: "g1",
                },
              ],
            }),
          );
        }

        if (prompt.includes('"qid": "Q41"')) {
          return Promise.resolve(
            JSON.stringify({
              groups: [
                {
                  decisions: [
                    {
                      candidateId: "paged",
                      decision: "recall",
                      qid: "Q41",
                    },
                  ],
                  groupId: "g1",
                },
              ],
            }),
          );
        }

        return Promise.resolve(
          JSON.stringify({
            groups: [
              {
                decisions: [
                  {
                    candidateId: "paged",
                    decision: "continue",
                  },
                ],
                groupId: "g1",
              },
            ],
          }),
        );
      });

    const mentions = await groundWikimatchCandidates({
      candidates: [
        {
          id: "history",
          qidOptions: [{ qid: "Q2" }],
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
        .find((prompt) => prompt.includes('"qid": "Q41"')) ?? "";

    expect(secondPrompt).not.toContain('"qid": "Q2"');
    expect(secondPrompt).toContain('"qid": "Q41"');
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

  it("commits chapter mention evidence from JSONL artifacts", async () => {
    await withTempDir("spinedigest-knowledge-graph-build-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        await document.openSession(async (openedDocument) => {
          await openedDocument.serials.createWithId(1);
        });

        const artifact = await buildChapterKnowledgeGraphArtifact(1, {
          mentionLinks: [
            {
              confidence: 0.8,
              evidenceEnd: 15,
              evidenceStart: 0,
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
              fragmentId: 10,
              id: "m1",
              qid: "Q205194",
              rangeEnd: 2,
              rangeStart: 0,
              sentenceIndex: 0,
              surface: "恩典",
            },
            {
              chapterId: 1,
              fragmentId: 10,
              id: "m2",
              qid: "Q9476",
              rangeEnd: 7,
              rangeStart: 3,
              sentenceIndex: 0,
              surface: "自由意志",
            },
          ],
          workspacePath: `${path}/workspace`,
        });

        await commitChapterKnowledgeGraphArtifact(document, artifact);

        expect(await document.mentions.listByChapter(1)).toHaveLength(2);
        expect(await document.mentionLinks.listByChapter(1)).toStrictEqual([
          {
            confidence: 0.8,
            evidenceEnd: 15,
            evidenceStart: 0,
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
                fragmentId: 20,
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
            evidenceEnd: 15,
            evidenceStart: 0,
            id: "l1",
            predicate: "discusses",
            sourceMentionId: "m1",
            targetMentionId: "m2",
          },
        ]);

        await clearChapterKnowledgeGraph(document, 1);

        expect(await document.mentions.listByChapter(1)).toStrictEqual([]);
      } finally {
        await document.release();
      }
    });
  });

  it("rejects mention links that point outside the artifact", async () => {
    await withTempDir("spinedigest-knowledge-graph-build-", async (path) => {
      const document = await DirectoryDocument.open(`${path}/document`);

      try {
        const artifact = await buildChapterKnowledgeGraphArtifact(1, {
          mentionLinks: [
            {
              id: "l1",
              predicate: "mentions",
              sourceMentionId: "m1",
              targetMentionId: "missing",
            },
          ],
          mentions: [
            {
              chapterId: 1,
              fragmentId: 10,
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
    await withTempDir("spinedigest-knowledge-graph-build-", async (path) => {
      await expect(
        buildChapterKnowledgeGraphArtifact(1, {
          mentionLinks: [],
          mentions: [
            {
              chapterId: 1,
              fragmentId: 10,
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
