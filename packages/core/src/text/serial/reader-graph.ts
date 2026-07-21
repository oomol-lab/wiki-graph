import type { ReaderChunk, ReaderGraphDelta } from "../reader/index.js";
import type { Topology } from "../../graph/topology/index.js";

export function createNumberListRecord(): Record<string, number[] | undefined> {
  return Object.create(null) as Record<string, number[] | undefined>;
}

export function saveDelta(
  allChunks: ReaderChunk[],
  successorIdsByChunkId: Record<string, number[] | undefined>,
  topology: Topology,
  delta: ReaderGraphDelta,
): void {
  topology.accept(delta);
  allChunks.push(...delta.chunks);

  for (const edge of delta.edges) {
    appendSuccessor(successorIdsByChunkId, edge.fromId, edge.toId);
  }
}

function appendSuccessor(
  successorIdsByChunkId: Record<string, number[] | undefined>,
  fromId: number,
  toId: number,
): void {
  const existingSuccessors = successorIdsByChunkId[String(fromId)] ?? [];

  if (existingSuccessors.includes(toId)) {
    return;
  }

  successorIdsByChunkId[String(fromId)] = [...existingSuccessors, toId].sort(
    compareNumber,
  );
}

function compareNumber(left: number, right: number): number {
  return left - right;
}
