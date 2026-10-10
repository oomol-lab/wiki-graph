import { mkdir, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  CHAPTER_JOB_KINDS,
  executeChapterJobFile,
  readChapterJobArtifact,
  type ChapterJobArtifactRecord,
  type ChapterJobKind,
  type JobLlm,
} from "wiki-graph-job";
import { WikiGraphArchiveFile, type ReadonlyDocument } from "wiki-graph-core";
import { afterEach, describe, expect, it } from "vitest";

import { NodeDirectory, NodeFile } from "./node-platform.js";
import { createWikiGraphSDK, type WikiGraphSDK } from "./sdk.js";
import {
  applyWikiGraphJobArtifacts,
  writeChapterJobInputFile,
} from "./worker.js";
import { resolveWikiGraphArchiveLocation } from "./archive/target.js";
import type { WikiGraphArchiveHandle } from "./archive/archive.js";

const ARCHIVE_IDENTITIES = ["standalone", "library"] as const;
const SOURCE =
  "Douglas Adams wrote The Hitchhiker's Guide to the Galaxy. He carried a towel for the journey.";
const SUMMARY = "Douglas Adams authored the Guide and carried a towel.";
const EMBEDDING = [0.125, 0.25, 0.5] as const;
const temporaryDirectories: string[] = [];

type ArchiveIdentity = (typeof ARCHIVE_IDENTITIES)[number];

interface ArtifactExpectation {
  readonly artifactRecordTypes: readonly ChapterJobArtifactRecord["type"][];
  readonly verifyDocument: (
    document: ReadonlyDocument,
    chapterId: number,
  ) => Promise<void>;
}

const ARTIFACT_EXPECTATIONS = {
  "index-embedding-source": {
    artifactRecordTypes: ["embedding-metadata", "embedding-segment"],
    verifyDocument: async (document, chapterId) => {
      const artifact = await document.indexArtifacts.get(
        chapterId,
        "embedding-source",
      );
      expect(artifact).toMatchObject({
        metadata: {
          dimensions: EMBEDDING.length,
          identity: "artifact-matrix",
          model: "artifact-matrix-model",
        },
        serialId: chapterId,
      });
      const segments = await document.indexArtifacts.listEmbeddingSegments(
        chapterId,
        "embedding-source",
      );
      expect(segments.length).toBeGreaterThan(0);
      expect(segments.every((segment) => segment.vector.length === 3)).toBe(
        true,
      );
      expect(segments[0]?.vector).toEqual(EMBEDDING);
    },
  },
  "index-embedding-summary": {
    artifactRecordTypes: ["embedding-metadata", "embedding-segment"],
    verifyDocument: async (document, chapterId) => {
      const artifact = await document.indexArtifacts.get(
        chapterId,
        "embedding-summary",
      );
      expect(artifact).toMatchObject({
        metadata: {
          dimensions: EMBEDDING.length,
          identity: "artifact-matrix",
          model: "artifact-matrix-model",
        },
        serialId: chapterId,
      });
      const segments = await document.indexArtifacts.listEmbeddingSegments(
        chapterId,
        "embedding-summary",
      );
      expect(segments.length).toBeGreaterThan(0);
      expect(segments.every((segment) => segment.vector.length === 3)).toBe(
        true,
      );
      expect(segments[0]?.vector).toEqual(EMBEDDING);
    },
  },
  "index-fts": {
    artifactRecordTypes: ["lexical-row"],
    verifyDocument: async (document, chapterId) => {
      const artifact = await document.indexArtifacts.get(chapterId, "fts");
      expect(artifact).toMatchObject({
        metadata: { source: "chapter-lexical", version: 1 },
        serialId: chapterId,
      });
      const rows = await document.indexArtifacts.listLexicalRows(chapterId);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            objectKind: "chapter-title",
            text: "Artifact matrix chapter",
          }),
        ]),
      );
      expect(
        rows.some(
          (row) =>
            row.objectKind === "source-sentence" &&
            row.text.includes("Douglas Adams"),
        ),
      ).toBe(true);
    },
  },
  "knowledge-graph": {
    artifactRecordTypes: ["job-parameter", "mention", "mention-link"],
    verifyDocument: async (document, chapterId) => {
      expect(
        (await document.serials.getById(chapterId))?.knowledgeGraphReady,
      ).toBe(true);
      expect(await document.mentions.listByChapter(chapterId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ qid: "Q42", surface: "Douglas Adams" }),
          expect.objectContaining({
            qid: "Q25169",
            surface: "The Hitchhiker's Guide to the Galaxy",
          }),
        ]),
      );
      expect(await document.mentionLinks.listByChapter(chapterId)).toEqual([
        expect.objectContaining({ predicate: "author" }),
      ]);
      expect(await document.indexArtifacts.listLexicalRows(chapterId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            objectKind: "mention-surface",
            text: "Douglas Adams",
          }),
        ]),
      );
    },
  },
  "reading-graph": {
    artifactRecordTypes: [
      "job-parameter",
      "reading-chunk",
      "reading-edge",
      "fragment-group",
      "snake",
      "snake-chunk",
    ],
    verifyDocument: async (document, chapterId) => {
      expect((await document.serials.getById(chapterId))?.topologyReady).toBe(
        true,
      );
      expect(await document.chunks.listBySerial(chapterId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "Authorship" }),
          expect.objectContaining({ label: "Travel preparation" }),
        ]),
      );
      expect(await document.readingEdges.listBySerial(chapterId)).toHaveLength(
        1,
      );
      expect(
        await document.fragmentGroups.listBySerial(chapterId),
      ).not.toHaveLength(0);
      expect(await document.snakes.listBySerial(chapterId)).not.toHaveLength(0);
      expect(await document.indexArtifacts.listLexicalRows(chapterId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            objectKind: "chunk-label",
            text: "Authorship",
          }),
        ]),
      );
    },
  },
  "reading-summary": {
    artifactRecordTypes: ["summary-part"],
    verifyDocument: async (document, chapterId) => {
      const summary = await document.readSummary(chapterId);
      expect(summary).toBeTruthy();
      expect(summary).toContain("Douglas Adams");
      expect((await document.serials.getById(chapterId))?.topologyReady).toBe(
        true,
      );
      const rows = await document.indexArtifacts.listLexicalRows(chapterId);
      expect(
        rows.some(
          (row) =>
            row.objectKind === "summary-sentence" &&
            row.text.includes("Douglas Adams"),
        ),
      ).toBe(true);
    },
  },
} satisfies Record<ChapterJobKind, ArtifactExpectation>;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(
        async (directory) =>
          await rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe("real job artifact application matrix", () => {
  it("keeps the matrix exhaustive when artifact kinds change", () => {
    expect(Object.keys(ARTIFACT_EXPECTATIONS).sort()).toEqual(
      [...CHAPTER_JOB_KINDS].sort(),
    );
    expect(ARCHIVE_IDENTITIES).toEqual(["standalone", "library"]);
  });

  describe.each(ARCHIVE_IDENTITIES)("%s archive", (identity) => {
    it.each(CHAPTER_JOB_KINDS)(
      "applies a complete real %s artifact and synchronizes derived state",
      async (kind) => {
        const scenario = await createScenario(identity, kind);
        try {
          const beforeInspection = await scenario.archive.inspect({
            chapterId: scenario.chapterId,
          });
          expect(beforeInspection.localIndexCache.current).toBe(true);
          const cursor = await createCollectionCursor(
            scenario.sdk,
            scenario.archive,
          );
          const beforeMember =
            scenario.memberUri === undefined
              ? undefined
              : await scenario.sdk.libraries.getArchive(scenario.memberUri);
          const beforeLibraryIndex =
            scenario.libraryUri === undefined
              ? undefined
              : await scenario.sdk.libraries.indexState(scenario.libraryUri);

          const artifact = await executeRealArtifact(scenario, kind, "target");
          assertCompleteArtifact(kind, artifact.records);
          await expectFileToBeReadable(artifact.path);

          await expect(
            applyWikiGraphJobArtifacts({
              archive: scenario.archive.target,
              artifacts: oneArtifact({
                artifactPath: artifact.path,
                chapterId: scenario.chapterId,
                kind,
              }),
              stateDir: scenario.stateDir,
            }),
          ).resolves.toEqual({ applied: 1 });

          await readTargetDocument(scenario, async (document) => {
            const revision = await document.serials.getRevision(
              scenario.chapterId,
            );
            await ARTIFACT_EXPECTATIONS[kind].verifyDocument(
              document,
              scenario.chapterId,
            );
            if (kind.startsWith("index-")) {
              const indexKind =
                kind === "index-fts"
                  ? "fts"
                  : kind === "index-embedding-source"
                    ? "embedding-source"
                    : "embedding-summary";
              expect(
                await document.indexArtifacts.get(
                  scenario.chapterId,
                  indexKind,
                ),
              ).toMatchObject({ sourceRevision: revision });
            }
          });

          const afterInspection = await scenario.archive.inspect({
            chapterId: scenario.chapterId,
          });
          expect(afterInspection.localIndexCache.current).toBe(false);
          expect(afterInspection.chapters).toHaveLength(1);
          await scenario.archive.ensureSearchIndex();
          expect(
            (
              await scenario.archive.inspect({
                chapterId: scenario.chapterId,
              })
            ).localIndexCache.current,
          ).toBe(true);
          await expect(
            scenario.sdk.continuations.next({ cursor }),
          ).rejects.toThrow("not found or has expired");

          if (
            scenario.libraryUri !== undefined &&
            scenario.memberUri !== undefined &&
            beforeMember !== undefined &&
            beforeLibraryIndex !== undefined
          ) {
            const [afterMember, afterLibraryIndex] = await Promise.all([
              scenario.sdk.libraries.getArchive(scenario.memberUri),
              scenario.sdk.libraries.indexState(scenario.libraryUri),
            ]);
            expect(afterMember.lastSeenMutationToken).not.toBe(
              beforeMember.lastSeenMutationToken,
            );
            expect(afterLibraryIndex.status).toBe("current");
            expect(afterLibraryIndex.sourceFingerprint).not.toBe(
              beforeLibraryIndex.sourceFingerprint,
            );
            expect(afterLibraryIndex.fingerprint).not.toBe(
              beforeLibraryIndex.fingerprint,
            );
            if (kind.startsWith("index-embedding-")) {
              expect(afterLibraryIndex.capabilities).toMatchObject({
                dense: {
                  current: true,
                  dimensions: EMBEDDING.length,
                  identity: "artifact-matrix",
                  model: "artifact-matrix-model",
                },
                indexes: "fts,dense",
              });
            }
          }
        } finally {
          scenario.sdk.close();
        }
      },
    );
  });
});

interface Scenario {
  readonly archive: WikiGraphArchiveHandle;
  readonly chapterId: number;
  readonly libraryUri?: string;
  readonly memberUri?: string;
  readonly root: string;
  readonly sdk: WikiGraphSDK;
  readonly stateDir: string;
}

async function createScenario(
  identity: ArchiveIdentity,
  targetKind: ChapterJobKind,
): Promise<Scenario> {
  const root = await mkdtemp(join(tmpdir(), "wiki-graph-artifact-matrix-"));
  temporaryDirectories.push(root);
  const stateDir = join(root, "state");
  const sourcePath = join(root, "source.wikg");
  const sdk = createWikiGraphSDK({ cwd: root, stateDir });
  await sdk.archives.create({ path: sourcePath });
  let archive = await sdk.archives.open({
    kind: "standalone",
    path: sourcePath,
  });
  const chapter = await archive.addChapter({
    source: SOURCE,
    title: "Artifact matrix chapter",
  });
  const sentinel = await archive.addChapter({
    source: "A second chapter keeps collection cursors durable.",
    title: "Cursor sentinel",
  });

  const setupScenario: Scenario = {
    archive,
    chapterId: chapter.chapterId,
    root,
    sdk,
    stateDir,
  };
  if (
    targetKind === "reading-summary" ||
    targetKind === "index-embedding-summary"
  ) {
    await executeAndApplySetupArtifact(setupScenario, "reading-graph");
  }
  if (targetKind === "index-embedding-summary") {
    await archive.setChapterSummary(chapter.path, SUMMARY);
  }
  await executeAndApplySetupArtifact(setupScenario, "index-fts");
  await executeAndApplySetupArtifact(
    setupScenario,
    "index-fts",
    sentinel.chapterId,
  );

  let libraryUri: string | undefined;
  let memberUri: string | undefined;
  if (identity === "library") {
    const library = await sdk.libraries.create("library");
    const member = await sdk.libraries.addArchive({
      inputPath: sourcePath,
      target: library.uri,
      to: "managed.wikg",
    });
    libraryUri = library.uri;
    memberUri = member.uri;
    archive = await sdk.archives.open({ kind: "library", uri: member.uri });
    await sdk.libraries.rebuildIndex(library.uri);
  }

  await archive.ensureSearchIndex();
  return {
    archive,
    chapterId: chapter.chapterId,
    ...(libraryUri === undefined ? {} : { libraryUri }),
    ...(memberUri === undefined ? {} : { memberUri }),
    root,
    sdk,
    stateDir,
  };
}

async function executeAndApplySetupArtifact(
  scenario: Scenario,
  kind: "index-fts" | "reading-graph",
  chapterId = scenario.chapterId,
): Promise<void> {
  const artifact = await executeRealArtifact(
    scenario,
    kind,
    `setup-${chapterId}-${kind}`,
    chapterId,
  );
  assertCompleteArtifact(kind, artifact.records);
  await applyWikiGraphJobArtifacts({
    archive: scenario.archive.target,
    artifacts: oneArtifact({
      artifactPath: artifact.path,
      chapterId,
      kind,
    }),
    stateDir: scenario.stateDir,
  });
}

async function executeRealArtifact(
  scenario: Scenario,
  kind: ChapterJobKind,
  label: string,
  chapterId = scenario.chapterId,
): Promise<{
  readonly path: string;
  readonly records: readonly ChapterJobArtifactRecord[];
}> {
  const workspacePath = join(scenario.root, `${label}-${kind}`);
  const inputPath = join(workspacePath, "input.jsonl");
  const outputPath = join(workspacePath, "output");
  await mkdir(outputPath, { recursive: true });
  const revision = await readTargetDocument(
    scenario,
    async (document) =>
      await writeChapterJobInputFile(
        document,
        chapterId,
        kind,
        new NodeFile(inputPath),
      ),
  );
  const capabilities = createExecutionCapabilities(kind);
  const result = await executeChapterJobFile({
    ...capabilities,
    inputFile: new NodeFile(inputPath),
    kind,
    revision,
    workspace: new NodeDirectory(outputPath),
  });
  expect(result.revision).toBe(revision);
  const path = join(outputPath, "artifact.jsonl");
  const records = await collect(readChapterJobArtifact(new NodeFile(path)));
  return { path, records };
}

function createExecutionCapabilities(kind: ChapterJobKind) {
  const embeddingProvider = {
    dimensions: EMBEDDING.length,
    embedTexts: (texts: readonly string[]) =>
      Promise.resolve({ embeddings: texts.map(() => EMBEDDING) }),
    identity: "artifact-matrix",
    model: "artifact-matrix-model",
  };
  if (kind === "index-embedding-source" || kind === "index-embedding-summary") {
    return { embeddingProvider };
  }
  if (kind === "reading-graph" || kind === "reading-summary") {
    return { llm: createReadingLlm() };
  }
  if (kind === "knowledge-graph") {
    return {
      llm: createKnowledgeLlm(),
      wikimedia: {
        resolve: async function* (input: readonly { readonly qid: string }[]) {
          await Promise.resolve();
          for (const [index, item] of input.entries()) {
            yield {
              index,
              resolution: {
                en: {
                  description:
                    item.qid === "Q42"
                      ? "English writer"
                      : "Novel by Douglas Adams",
                  label:
                    item.qid === "Q42"
                      ? "Douglas Adams"
                      : "The Hitchhiker's Guide to the Galaxy",
                  url: `https://example.test/${item.qid}`,
                },
                qid: item.qid,
                zh: { description: null, label: null, url: null },
              },
            };
          }
        },
      },
      wikispine: {
        match: async function* () {
          await Promise.resolve();
          yield {
            end: "Douglas Adams".length,
            qids: [{ disambiguation: false, qid: "Q42" }],
            start: 0,
          };
          const start = SOURCE.indexOf("The Hitchhiker's Guide to the Galaxy");
          yield {
            end: start + "The Hitchhiker's Guide to the Galaxy".length,
            qids: [{ disambiguation: false, qid: "Q25169" }],
            start,
          };
        },
      },
    };
  }
  return {};
}

function createReadingLlm(): JobLlm {
  const responses = [
    JSON.stringify({
      chunks: [
        {
          content: "Douglas Adams authored the Hitchhiker's Guide.",
          evidence: [
            {
              quote:
                "Douglas Adams wrote The Hitchhiker's Guide to the Galaxy.",
              sentence_id: "S1",
            },
          ],
          label: "Authorship",
          retention: "focused",
          temp_id: "A",
        },
        {
          content: "A towel was prepared for the journey.",
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
      fragment_summary: SUMMARY,
      links: [{ from: "A", strength: "strong", to: "B" }],
    }),
    JSON.stringify({ chunks: [], importance_annotations: [], links: [] }),
  ];
  return {
    request: (_messages, options) => {
      if (options.scope === "reading-summary-review-guide") {
        return Promise.resolve("Preserve authorship and the towel.");
      }
      if (options.scope === "reading-summary-compress") {
        return Promise.resolve(`<final>${SUMMARY}</final>`);
      }
      if (options.scope === "reading-summary-review") {
        return Promise.resolve('{"issues":[]}');
      }
      const response = responses.shift();
      if (response === undefined) {
        throw new Error(`Unexpected Reading Graph request: ${options.scope}`);
      }
      return Promise.resolve(response);
    },
  };
}

function createKnowledgeLlm(): JobLlm {
  return {
    request: (messages) => {
      const prompt = messages.map((message) => message.content).join("\n");
      if (prompt.includes("precomputed Wikidata mention candidates")) {
        const groups = prompt
          .split("\n")
          .filter((line) => line.startsWith('{"candidates":'))
          .map((line) => JSON.parse(line) as CandidateGroup);
        return Promise.resolve(
          JSON.stringify({
            groups: groups.map((group) => ({
              decisions: group.candidates.map((candidate) => ({
                candidateId: candidate.candidateId,
                decision: "recall",
                qid: candidate.entityOptions[0]!.qid,
              })),
              groupId: group.groupId,
            })),
          }),
        );
      }
      if (prompt.includes("Suspicious high-frequency surfaces")) {
        const surfaceIds = [...prompt.matchAll(/"surfaceId": "(s\d+)"/gu)].map(
          (match) => match[1]!,
        );
        return Promise.resolve(
          JSON.stringify({
            protectedSurfaces: [...new Set(surfaceIds)].map((surfaceId) => ({
              surfaceId,
            })),
          }),
        );
      }
      if (
        prompt.includes("semantic relations between grounded entity mentions")
      ) {
        return Promise.resolve(
          JSON.stringify({
            relations: [
              {
                confidence: 0.99,
                evidence: {
                  quote:
                    "Douglas Adams wrote The Hitchhiker's Guide to the Galaxy",
                  sentence_id: "S1",
                },
                predicate: "author",
                sourceMentionId: readMentionId(prompt, "Q42"),
                targetMentionId: readMentionId(prompt, "Q25169"),
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected Knowledge Graph prompt:\n${prompt}`);
    },
  };
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
    throw new Error(`Relation prompt is missing a ${qid} mention.`);
  }
  return match[1];
}

function assertCompleteArtifact(
  kind: ChapterJobKind,
  records: readonly ChapterJobArtifactRecord[],
): void {
  expect(records.length).toBeGreaterThan(0);
  const recordTypes = new Set(records.map((record) => record.type));
  for (const requiredType of ARTIFACT_EXPECTATIONS[kind].artifactRecordTypes) {
    expect(recordTypes, `${kind} is missing ${requiredType}`).toContain(
      requiredType,
    );
  }
}

async function expectFileToBeReadable(path: string): Promise<void> {
  const reader = await new NodeFile(path).openReader();
  try {
    expect(reader.size).toBeGreaterThan(0);
  } finally {
    await reader.close();
  }
}

async function readTargetDocument<T>(
  scenario: Pick<Scenario, "archive" | "sdk">,
  operation: (document: ReadonlyDocument) => Promise<T>,
): Promise<T> {
  return await scenario.sdk.run(async () => {
    const location = await resolveWikiGraphArchiveLocation(
      scenario.archive.target,
    );
    return await new WikiGraphArchiveFile(location.archiveFile).readDocument(
      operation,
    );
  });
}

function oneArtifact(input: {
  readonly artifactPath: string;
  readonly chapterId: number;
  readonly kind: ChapterJobKind;
}): AsyncIterable<typeof input> {
  return (async function* () {
    await Promise.resolve();
    yield input;
  })();
}

async function createCollectionCursor(
  sdk: WikiGraphSDK,
  archive: WikiGraphArchiveHandle,
): Promise<string> {
  const page = await archive.list({ limit: 1, types: ["chapter-title"] });
  if (page.rawNextCursor === null) {
    throw new Error("Expected a collection continuation cursor.");
  }
  const cursor = await sdk.continuations.create(
    {
      archiveKey: archive.archiveKey,
      archivePath: archive.path,
      continuationKind: "collection",
      format: "json",
      indexScope: archive.indexScope,
      order: "doc-asc",
      types: ["chapter-title"],
    },
    page.rawNextCursor,
  );
  if (cursor === null) throw new Error("Expected a durable cursor.");
  return cursor;
}

async function collect<T>(records: AsyncIterable<T>): Promise<readonly T[]> {
  const output: T[] = [];
  for await (const record of records) output.push(record);
  return output;
}
