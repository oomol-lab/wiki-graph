import type { FragmentRecord, ReadonlyDocument } from "../../document/index.js";
import type { WikimatchSentence } from "../../external/wikimatch/index.js";

export async function readChapterFragments(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<readonly FragmentRecord[]> {
  const serialFragments = document.getSerialFragments(chapterId);

  return await Promise.all(
    (await serialFragments.listFragmentIds()).map(
      async (fragmentId) => await serialFragments.getFragment(fragmentId),
    ),
  );
}

export function joinFragmentText(fragments: readonly FragmentRecord[]): string {
  return fragments
    .flatMap((fragment) => fragment.sentences.map((sentence) => sentence.text))
    .join(" ");
}

export function createWikimatchSentences(
  fragments: readonly FragmentRecord[],
): readonly WikimatchSentence[] {
  const sentences: WikimatchSentence[] = [];
  let offset = 0;

  for (const fragment of fragments) {
    for (let index = 0; index < fragment.sentences.length; index += 1) {
      const sentence = fragment.sentences[index]!;

      sentences.push({
        id: `${fragment.serialId}:${fragment.fragmentId + index}`,
        range: {
          end: offset + sentence.text.length,
          start: offset,
        },
        text: sentence.text,
      });
      offset += sentence.text.length + 1;
    }
  }

  return sentences;
}
