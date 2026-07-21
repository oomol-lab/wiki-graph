import type { SentenceGroupRecord } from "../../document/index.js";
import { computeNormalizedSegmentIncisions } from "./segment-incision.js";
import { createSegmentGroups } from "./resource-segmentation.js";

export async function groupSegments(input: {
  edges: Parameters<typeof computeNormalizedSegmentIncisions>[0]["edges"];
  fragments: Parameters<
    typeof computeNormalizedSegmentIncisions
  >[0]["fragments"];
  groupWordsCount: number;
  chunks: Parameters<typeof computeNormalizedSegmentIncisions>[0]["chunks"];
  serialId: number;
}): Promise<SentenceGroupRecord[]> {
  const segmentInfos = await computeNormalizedSegmentIncisions({
    chunks: input.chunks,
    edges: input.edges,
    fragments: input.fragments,
  });

  return createSegmentGroups({
    segmentInfos,
    groupWordsCount: input.groupWordsCount,
    serialId: input.serialId,
  });
}
