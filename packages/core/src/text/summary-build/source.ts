import type { FragmentRecord, ReadonlyDocument } from "../../document/index.js";
import type { ReaderTextStream } from "../reader/index.js";

export async function readSerialFragments(
  document: ReadonlyDocument,
  serialId: number,
): Promise<readonly FragmentRecord[]> {
  const fragments = document.getSerialFragments(serialId);

  return await Promise.all(
    (await fragments.listFragmentIds()).map(
      async (fragmentId) => await fragments.getFragment(fragmentId),
    ),
  );
}

export async function* readChapterSource(
  document: ReadonlyDocument,
  chapterId: number,
): ReaderTextStream {
  const fragments = document.getSerialFragments(chapterId);

  for (const fragmentId of await fragments.listFragmentIds()) {
    const fragment = await fragments.getFragment(fragmentId);

    for (const sentence of fragment.sentences) {
      yield sentence.text;
    }
  }
}

export async function collectReaderText(
  stream: ReaderTextStream,
): Promise<readonly string[]> {
  const text: string[] = [];

  for await (const chunk of stream) {
    text.push(chunk);
  }

  return text;
}
