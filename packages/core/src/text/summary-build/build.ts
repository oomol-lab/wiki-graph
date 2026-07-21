import { WIKI_GRAPH_EDITOR_SCOPES } from "../../runtime/common/llm-scope.js";
import type {
  ReadonlyDocument,
  ReadonlySerialFragments,
} from "../../document/index.js";
import { compressText } from "../editor/index.js";
import type { BuildChapterSummaryArtifactOptions } from "./types.js";

export async function buildSummaryFromDocument(
  document: ReadonlyDocument,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  const serial = await document.serials.getById(chapterId);

  if (serial === undefined) {
    throw new Error(
      `Chapter ${chapterId} does not exist. Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`,
    );
  }
  if (!serial.topologyReady) {
    throw new Error(`Chapter ${chapterId} is not ready for summary.`);
  }

  return await buildSummaryFromReadyDocument(document, chapterId, options);
}

export async function buildSummaryFromReadyDocument(
  document: ReadonlyDocument,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  const fragments = document.getSerialFragments(chapterId);
  const sentenceStartIndexes = await fragments.listFragmentIds();

  if (sentenceStartIndexes.length <= 1) {
    return await readPassthroughSummary(fragments, sentenceStartIndexes);
  }

  const summaryParts: string[] = [];

  for (const groupId of await document.fragmentGroups.listGroupIdsForSerial(
    chapterId,
  )) {
    const groupSummary = await compressText({
      compressionRatio: 0.2,
      document,
      groupId,
      llm: options.llm,
      maxClues: 10,
      maxIterations: 5,
      scopes: WIKI_GRAPH_EDITOR_SCOPES,
      serialId: chapterId,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });

    if (groupSummary.trim() === "") {
      continue;
    }
    summaryParts.push(groupSummary);
  }

  return summaryParts.join("\n\n");
}

export async function readPassthroughSummary(
  fragments: ReadonlySerialFragments,
  sentenceStartIndexes: readonly number[],
): Promise<string> {
  if (sentenceStartIndexes.length === 0) {
    return "";
  }

  const records = await Promise.all(
    sentenceStartIndexes.map(
      async (startSentenceIndex) =>
        await fragments.getFragment(startSentenceIndex),
    ),
  );

  return records
    .flatMap((fragment) => fragment.sentences.map((sentence) => sentence.text))
    .join(" ")
    .trim();
}
