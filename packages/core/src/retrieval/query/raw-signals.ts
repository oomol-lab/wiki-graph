import type { WikiGraphRetrievalSignals } from "../../api/objects.js";

export interface EvidenceRetrievalSignal extends WikiGraphRetrievalSignals {
  readonly evidenceId: string;
  readonly chapterId: number;
  readonly sentenceIndex: number;
}
/** Multiple matched sentences do not acquire an invented range score. */
export function commonRetrievalSignals(
  values: readonly WikiGraphRetrievalSignals[],
): WikiGraphRetrievalSignals {
  const first = values[0];
  if (first === undefined || values.length !== 1) return {};
  return {
    ...(first.ftsScore !== undefined ? { ftsScore: first.ftsScore } : {}),
    ...(first.embeddingScore !== undefined
      ? { embeddingScore: first.embeddingScore }
      : {}),
  };
}
