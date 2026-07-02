import type { SentenceGroupRecord } from "../document/index.js";
import { computeNormalizedFragmentIncisions } from "./fragment-incision.js";
import { createFragmentGroups } from "./resource-segmentation.js";

export async function groupFragments(input: {
  edges: Parameters<typeof computeNormalizedFragmentIncisions>[0]["edges"];
  fragments: Parameters<
    typeof computeNormalizedFragmentIncisions
  >[0]["fragments"];
  groupWordsCount: number;
  chunks: Parameters<typeof computeNormalizedFragmentIncisions>[0]["chunks"];
  serialId: number;
}): Promise<SentenceGroupRecord[]> {
  const fragmentInfos = await computeNormalizedFragmentIncisions({
    chunks: input.chunks,
    edges: input.edges,
    fragments: input.fragments,
  });

  return createFragmentGroups({
    fragmentInfos,
    groupWordsCount: input.groupWordsCount,
    serialId: input.serialId,
  });
}
