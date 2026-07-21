import type { ChunkRecord } from "../../document/index.js";
import type { EdgeQueueEntry } from "./types.js";

export function compareChunkBySentence(
  left: ChunkRecord,
  right: ChunkRecord,
): number {
  const [leftSerialId, leftSentenceIndex] = left.sentenceId;
  const [rightSerialId, rightSentenceIndex] = right.sentenceId;

  if (leftSerialId !== rightSerialId) {
    return leftSerialId - rightSerialId;
  }

  if (leftSentenceIndex !== rightSentenceIndex) {
    return leftSentenceIndex - rightSentenceIndex;
  }

  return left.id - right.id;
}

export function compareEdgeQueueEntry(
  left: EdgeQueueEntry,
  right: EdgeQueueEntry,
): number {
  if (left.value !== right.value) {
    return right.value - left.value;
  }

  if (left.leftClusterId !== right.leftClusterId) {
    return left.leftClusterId - right.leftClusterId;
  }

  return left.rightClusterId - right.rightClusterId;
}

export function compareNumber(left: number, right: number): number {
  return left - right;
}
