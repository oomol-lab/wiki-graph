import type {
  FragmentRecord,
  MentionLinkRecord,
  MentionRecord,
} from "../../document/index.js";
import type { GuaranteedRequestController } from "../../external/guaranteed/index.js";
import {
  buildWikilinkEvidenceWindows,
  discoverWikilinkRelations,
  type WikilinkEvidenceWindow,
  type WikilinkMention,
  type WikilinkSentence,
} from "../../graph/wikilink/index.js";
import {
  WIKILINK_EVIDENCE_DISTANCE,
  WIKILINK_WINDOW_LENGTH,
} from "./constants.js";
import { mapLazyGuaranteedRequests } from "./request.js";
import type { KnowledgeGraphProgressTracker } from "./types.js";

export async function discoverMentionLinks(input: {
  readonly fragments: readonly FragmentRecord[];
  readonly mentions: readonly MentionRecord[];
  readonly progressTracker?: KnowledgeGraphProgressTracker;
  readonly request: GuaranteedRequestController;
}): Promise<readonly MentionLinkRecord[]> {
  const fragmentWindows = buildMentionLinkWindows(
    input.fragments,
    input.mentions,
  );
  let completedWindows = 0;

  await input.progressTracker?.updatePhase({
    done: 0,
    phase: "relation-discovery",
    total: fragmentWindows.length,
    unit: "window",
  });

  const discoveredLinks = (
    await mapLazyGuaranteedRequests(
      input.request,
      fragmentWindows,
      async (item, request) => {
        try {
          await input.progressTracker?.throwIfStopped();
          return await discoverWikilinkRelations({
            chapterId: item.fragment.serialId,
            fragmentId: item.fragment.fragmentId,
            request,
            sentences: item.fragment.sentences,
            window: item.window,
          });
        } finally {
          completedWindows += 1;
          await input.progressTracker?.updatePhase({
            done: completedWindows,
            phase: "relation-discovery",
            total: fragmentWindows.length,
            unit: "window",
          });
        }
      },
    )
  ).flat();

  return discoveredLinks.map((link, index) => ({
    ...(link.confidence === undefined ? {} : { confidence: link.confidence }),
    evidenceSentenceIds: link.evidenceSentenceIds,
    id: `l${input.fragments[0]?.serialId ?? 0}-${index + 1}`,
    predicate: link.predicate,
    sourceMentionId: link.sourceMentionId,
    targetMentionId: link.targetMentionId,
  }));
}

function buildMentionLinkWindows(
  fragments: readonly FragmentRecord[],
  mentions: readonly MentionRecord[],
): ReadonlyArray<{
  readonly fragment: FragmentRecord;
  readonly window: WikilinkEvidenceWindow;
}> {
  return fragments.flatMap((fragment) => {
    const startSentenceIndex = fragment.fragmentId;
    const endSentenceIndex = startSentenceIndex + fragment.sentences.length - 1;
    const fragmentMentions = toWikilinkMentions(
      fragment.sentences,
      mentions.filter(
        (mention) =>
          mention.sentenceIndex !== undefined &&
          mention.sentenceIndex >= startSentenceIndex &&
          mention.sentenceIndex <= endSentenceIndex,
      ),
      startSentenceIndex,
    );
    const windows = buildWikilinkEvidenceWindows({
      maxEvidenceDistance: WIKILINK_EVIDENCE_DISTANCE,
      mentions: fragmentMentions,
      text: joinSentences(fragment.sentences),
      windowLength: WIKILINK_WINDOW_LENGTH,
    });

    return windows.map((window) => ({
      fragment,
      window,
    }));
  });
}

function toWikilinkMentions(
  sentences: readonly WikilinkSentence[],
  mentions: readonly MentionRecord[],
  startSentenceIndex: number,
): readonly WikilinkMention[] {
  const sentenceOffsets = buildFragmentSentenceOffsets(sentences);

  return mentions.flatMap((mention) => {
    if (mention.sentenceIndex === undefined) {
      return [];
    }

    const sentenceOffset =
      sentenceOffsets[mention.sentenceIndex - startSentenceIndex];

    if (sentenceOffset === undefined) {
      return [];
    }

    return [
      {
        id: mention.id,
        qid: mention.qid,
        range: {
          end: sentenceOffset.start + mention.rangeEnd,
          start: sentenceOffset.start + mention.rangeStart,
        },
        surface: mention.surface,
      },
    ];
  });
}

function buildFragmentSentenceOffsets(
  sentences: readonly WikilinkSentence[],
): ReadonlyArray<{ readonly end: number; readonly start: number }> {
  const offsets: Array<{ readonly end: number; readonly start: number }> = [];
  let cursor = 0;

  for (const sentence of sentences) {
    const start = cursor;
    const end = start + sentence.text.length;

    offsets.push({ end, start });
    cursor = end + 1;
  }

  return offsets;
}

function joinSentences(sentences: readonly WikilinkSentence[]): string {
  return sentences.map((sentence) => sentence.text).join(" ");
}
