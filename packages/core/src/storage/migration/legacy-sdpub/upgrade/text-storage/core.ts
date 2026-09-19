import type { Directory } from "../../../../../runtime/platform/index.js";

import { Database } from "../../../../../document/database.js";
import {
  createDuplicateHalfCanonicalizationPlan,
  listLegacySourceSerials,
  readLegacySourceFragments,
} from "./fragments.js";
import { migrateLegacySentenceReferences } from "./references.js";
import { migrateLegacySummariesToTextStreams } from "./summaries.js";
import { writeLegacySourceTextStream } from "./source-text.js";
import type { SentenceIndexRemap } from "./types.js";

export async function migrateLegacyTextStorage(
  workspace: Directory,
): Promise<void> {
  const sourceSerials = await listLegacySourceSerials(workspace);
  const remaps = new Map<number, SentenceIndexRemap>();

  for (const serialId of sourceSerials) {
    const fragments = await readLegacySourceFragments(workspace, serialId);
    const plan = createDuplicateHalfCanonicalizationPlan(fragments);
    const canonicalFragments = plan?.canonicalFragments ?? fragments;
    const fragmentIdMap = plan?.fragmentIdMap ?? new Map<number, number>();
    const canonicalById = new Map(
      canonicalFragments.map((fragment) => [fragment.fragmentId, fragment]),
    );
    const sentenceMap = new Map<string, number>();
    const textParts: string[] = [];
    let globalSentenceIndex = 0;

    for (const fragment of canonicalFragments) {
      for (
        let localSentenceIndex = 0;
        localSentenceIndex < fragment.content.sentences.length;
        localSentenceIndex += 1
      ) {
        const sentence = fragment.content.sentences[localSentenceIndex];

        if (sentence === undefined) {
          continue;
        }

        sentenceMap.set(
          `${fragment.fragmentId}:${localSentenceIndex}`,
          globalSentenceIndex,
        );
        textParts.push(sentence.text);
        globalSentenceIndex += 1;
      }
    }

    for (const [oldFragmentId, canonicalFragmentId] of fragmentIdMap) {
      const canonicalFragment = canonicalById.get(canonicalFragmentId);

      if (canonicalFragment === undefined) {
        continue;
      }

      for (
        let localSentenceIndex = 0;
        localSentenceIndex < canonicalFragment.content.sentences.length;
        localSentenceIndex += 1
      ) {
        const mapped = sentenceMap.get(
          `${canonicalFragmentId}:${localSentenceIndex}`,
        );

        if (mapped !== undefined) {
          sentenceMap.set(`${oldFragmentId}:${localSentenceIndex}`, mapped);
        }
      }
    }

    remaps.set(serialId, {
      locateAtCharacterOffset: (fragmentId, offset) => {
        const fragment = fragments.find(
          (candidate) => candidate.fragmentId === fragmentId,
        );
        if (fragment === undefined) return undefined;
        let cursor = 0;
        let last:
          | {
              readonly sentenceIndex: number;
              readonly sentenceOffset: number;
            }
          | undefined;
        for (
          let localSentenceIndex = 0;
          localSentenceIndex < fragment.content.sentences.length;
          localSentenceIndex += 1
        ) {
          const sentence = fragment.content.sentences[localSentenceIndex];
          if (sentence === undefined) continue;
          const mapped = sentenceMap.get(`${fragmentId}:${localSentenceIndex}`);
          if (mapped === undefined) continue;
          last = { sentenceIndex: mapped, sentenceOffset: cursor };
          const nextCursor = cursor + sentence.text.length;
          if (Math.max(0, offset) <= nextCursor) return last;
          cursor = nextCursor + 1;
        }
        return last;
      },
      get: (fragmentId, sentenceIndex) =>
        sentenceMap.get(`${fragmentId}:${sentenceIndex}`),
      serialId,
    });

    const databaseFile = await workspace.getFile("database.db");
    if (databaseFile === undefined)
      throw new Error("Legacy database is missing.");
    const database = await Database.open(databaseFile, "", {
      create: false,
      mode: "readwrite",
    });

    try {
      await writeLegacySourceTextStream(database, workspace, {
        fragments: canonicalFragments,
        serialId,
        text: textParts.join(""),
      });
    } finally {
      await database.close();
    }
  }

  await migrateLegacySentenceReferences(workspace, remaps);
  await migrateLegacySummariesToTextStreams(workspace);
  await workspace
    .remove("fragments", { recursive: true })
    .catch(() => undefined);
  await workspace
    .remove("summaries", { recursive: true })
    .catch(() => undefined);
}
