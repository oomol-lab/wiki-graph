import type {
  FragmentRecord,
  MentionRecord,
} from "../../document/index.js";
import type { GuaranteedRequestController } from "../../guaranteed/index.js";
import type {
  WikimatchAcceptedMention,
  WikimatchCandidate,
} from "../../wikimatch/index.js";
import { groundWikimatchCandidates } from "./grounding-runner.js";
import type { KnowledgeGraphProgressTracker } from "./types.js";

export async function judgeCandidates(input: {
  readonly candidates: readonly WikimatchCandidate[];
  readonly chapterId: number;
  readonly fragments: readonly FragmentRecord[];
  readonly policyPrompt: string;
  readonly progressTracker?: KnowledgeGraphProgressTracker;
  readonly request: GuaranteedRequestController;
  readonly text: string;
}): Promise<readonly MentionRecord[]> {
  const mentions: MentionRecord[] = [];
  const sentenceLocations = buildSentenceLocations(input.fragments);
  const acceptedMentions = await groundWikimatchCandidates({
    candidates: input.candidates,
    policyPrompt: input.policyPrompt,
    ...(input.progressTracker === undefined
      ? {}
      : { progressTracker: input.progressTracker }),
    request: input.request,
    text: input.text,
  });
  let mentionIndex = 1;

  for (const mention of acceptedMentions) {
    const location = locateMention(sentenceLocations, mention.range.start);

    mentions.push(
      toMentionRecord(input.chapterId, mention, location, mentionIndex),
    );
    mentionIndex += 1;
  }

  return mentions;
}

function toMentionRecord(
  chapterId: number,
  mention: WikimatchAcceptedMention,
  location: {
    readonly rangeStart: number;
    readonly sentenceIndex: number;
  },
  index: number,
): MentionRecord {
  return {
    chapterId,
    ...(mention.confidence === undefined
      ? {}
      : { confidence: mention.confidence }),
    id: `m${chapterId}-${index}`,
    ...(mention.note === undefined ? {} : { note: mention.note }),
    qid: mention.qid,
    rangeEnd: location.rangeStart + mention.surface.length,
    rangeStart: location.rangeStart,
    sentenceIndex: location.sentenceIndex,
    surface: mention.surface,
  };
}

interface SentenceLocation {
  readonly absoluteStart: number;
  readonly length: number;
  readonly sentenceIndex: number;
}

function buildSentenceLocations(
  fragments: readonly FragmentRecord[],
): readonly SentenceLocation[] {
  const locations: SentenceLocation[] = [];
  let offset = 0;

  for (const fragment of fragments) {
    for (
      let sentenceIndex = 0;
      sentenceIndex < fragment.sentences.length;
      sentenceIndex += 1
    ) {
      const length = fragment.sentences[sentenceIndex]!.text.length;

      locations.push({
        absoluteStart: offset,
        length,
        sentenceIndex: fragment.fragmentId + sentenceIndex,
      });
      offset += length + 1;
    }
  }

  return locations;
}

function locateMention(
  locations: readonly SentenceLocation[],
  absoluteOffset: number,
): {
  readonly rangeStart: number;
  readonly sentenceIndex: number;
} {
  for (const location of locations) {
    const rangeEnd = location.absoluteStart + location.length;

    if (absoluteOffset >= location.absoluteStart && absoluteOffset < rangeEnd) {
      return {
        rangeStart: absoluteOffset - location.absoluteStart,
        sentenceIndex: location.sentenceIndex,
      };
    }
  }

  throw new Error(`Mention offset ${absoluteOffset} is outside chapter text.`);
}
