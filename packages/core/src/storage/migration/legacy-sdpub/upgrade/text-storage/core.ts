import { rm } from "fs/promises";
import { join } from "path";

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
  workspacePath: string,
): Promise<void> {
  const sourceSerials = await listLegacySourceSerials(workspacePath);
  const remaps = new Map<number, SentenceIndexRemap>();

  for (const serialId of sourceSerials) {
    const fragments = await readLegacySourceFragments(workspacePath, serialId);
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
      get: (fragmentId, sentenceIndex) =>
        sentenceMap.get(`${fragmentId}:${sentenceIndex}`),
      serialId,
    });

    const database = await Database.open(join(workspacePath, "database.db"));

    try {
      await writeLegacySourceTextStream(database, workspacePath, {
        fragments: canonicalFragments,
        serialId,
        text: textParts.join(""),
      });
    } finally {
      await database.close();
    }
  }

  await migrateLegacySentenceReferences(workspacePath, remaps);
  await migrateLegacySummariesToTextStreams(workspacePath);
  await rm(join(workspacePath, "fragments"), { force: true, recursive: true });
  await rm(join(workspacePath, "summaries"), { force: true, recursive: true });
}
