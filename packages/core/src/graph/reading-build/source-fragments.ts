import { Fragments } from "../../document/index.js";
import {
  segmentTextStream,
  type ReaderTextStream,
} from "../../text/reader/index.js";

const GRAPH_ARTIFACT_FRAGMENT_WORDS_COUNT = 320;

export async function writeGraphArtifactSourceFragments(
  documentPath: string,
  chapterId: number,
  sourceText: ReaderTextStream,
): Promise<void> {
  const fragments = new Fragments(documentPath);
  const serial = fragments.getSerial(chapterId);
  let draft = await serial.createDraft();
  let draftWordsCount = 0;
  let hasSentences = false;

  await fragments.ensureCreated();

  for await (const sentence of segmentTextStream(sourceText)) {
    const text = sentence.text.trim();

    if (text === "") {
      continue;
    }
    if (
      draftWordsCount > 0 &&
      draftWordsCount + sentence.wordsCount >
        GRAPH_ARTIFACT_FRAGMENT_WORDS_COUNT
    ) {
      await draft.commit();
      draft = await serial.createDraft();
      draftWordsCount = 0;
    }

    draft.addSentence(text, sentence.wordsCount);
    draftWordsCount += sentence.wordsCount;
    hasSentences = true;
  }

  if (hasSentences) {
    await draft.commit();
  } else {
    draft.discard();
  }
}
