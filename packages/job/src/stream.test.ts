import { describe, expect, it } from "vitest";

import {
  CHAPTER_JOB_PROTOCOL,
  type AnyChapterJobArtifact,
  type AnyChapterJobSnapshot,
} from "./contracts.js";
import {
  decodeChapterJobArtifact,
  decodeChapterJobSnapshot,
  encodeChapterJobArtifact,
  encodeChapterJobSnapshot,
} from "./stream.js";

describe("chapter job NDJSON stream", () => {
  it.each(snapshotFixtures())("round-trips $kind snapshots", async (snapshot) => {
    await expect(
      decodeChapterJobSnapshot(asAsync(encodeChapterJobSnapshot(snapshot))),
    ).resolves.toEqual(snapshot);
  });

  it.each(artifactFixtures())("round-trips $kind artifacts", async (artifact) => {
    await expect(
      decodeChapterJobArtifact(asAsync(encodeChapterJobArtifact(artifact))),
    ).resolves.toEqual(artifact);
  });
});

function snapshotFixtures(): readonly AnyChapterJobSnapshot[] {
  const base = { chapterId: 7, protocol: CHAPTER_JOB_PROTOCOL, revision: 11 };
  const sentence = { text: "Hello world.", wordsCount: 2 };
  return [
    {
      ...base,
      kind: "index-embedding-source",
      payload: { sentences: [sentence] },
    },
    {
      ...base,
      kind: "index-embedding-summary",
      payload: { sentences: [sentence] },
    },
    {
      ...base,
      kind: "index-fts",
      payload: {
        chapterTitles: [{ id: 7, title: "Chapter" }],
        chunks: [],
        mentions: [],
        sentences: [sentence],
        summarySentences: [],
      },
    },
    {
      ...base,
      kind: "knowledge-graph",
      payload: {
        fragments: [{ fragmentId: 0, sentences: [sentence], summary: "Hello" }],
        language: "en",
        policyPrompt: "policy",
      },
    },
    {
      ...base,
      kind: "reading-graph",
      payload: {
        extractionPrompt: "extract",
        language: "en",
        sourceText: ["Hello world."],
      },
    },
    {
      ...base,
      kind: "reading-summary",
      payload: { language: "en", prompt: "summarize", readingGraph: [] },
    },
  ];
}

function artifactFixtures(): readonly AnyChapterJobArtifact[] {
  const base = { chapterId: 7, protocol: CHAPTER_JOB_PROTOCOL, revision: 11 };
  return [
    {
      ...base,
      kind: "index-embedding-source",
      payload: {
        kind: "embedding-source",
        metadata: { version: 1 },
        segments: [],
      },
    },
    {
      ...base,
      kind: "index-embedding-summary",
      payload: {
        kind: "embedding-summary",
        metadata: { version: 1 },
        segments: [],
      },
    },
    {
      ...base,
      kind: "index-fts",
      payload: { lexicalRows: [], metadata: { version: 1 } },
    },
    {
      ...base,
      kind: "knowledge-graph",
      payload: { objects: [{ type: "end" }] },
    },
    {
      ...base,
      kind: "reading-graph",
      payload: { objects: [{ type: "end" }] },
    },
    {
      ...base,
      kind: "reading-summary",
      payload: { summary: "Hello." },
    },
  ];
}

async function* asAsync(values: Iterable<string>): AsyncIterable<string> {
  await Promise.resolve();
  yield* values;
}
