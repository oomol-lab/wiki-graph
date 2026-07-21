import type { ReadingEdgeRecord } from "../../document/index.js";
import { compareNumber } from "./compare.js";
import { attachChunkAdjacency } from "./graph.js";
import { createBooleanRecord, createNumberListRecord } from "./records.js";

export function splitConnectedComponents(input: {
  chunkIds: readonly number[];
  edges: readonly ReadingEdgeRecord[];
}): number[][] {
  const sortedChunkIds = [...input.chunkIds].sort(compareNumber);
  const chunkIdRecord = createBooleanRecord();
  const adjacentChunkIdsByChunkId = createNumberListRecord();
  const visitedChunkIds = createBooleanRecord();
  const components: number[][] = [];

  for (const chunkId of sortedChunkIds) {
    chunkIdRecord[String(chunkId)] = true;
  }

  for (const edge of input.edges) {
    if (
      chunkIdRecord[String(edge.fromId)] !== true ||
      chunkIdRecord[String(edge.toId)] !== true
    ) {
      continue;
    }

    attachChunkAdjacency(adjacentChunkIdsByChunkId, edge.fromId, edge.toId);
    attachChunkAdjacency(adjacentChunkIdsByChunkId, edge.toId, edge.fromId);
  }

  for (const chunkId of sortedChunkIds) {
    if (visitedChunkIds[String(chunkId)] === true) {
      continue;
    }

    const stack = [chunkId];
    const component: number[] = [];
    visitedChunkIds[String(chunkId)] = true;

    while (stack.length > 0) {
      const currentChunkId = stack.pop();

      if (currentChunkId === undefined) {
        continue;
      }

      component.push(currentChunkId);

      for (const nextChunkId of adjacentChunkIdsByChunkId[
        String(currentChunkId)
      ] ?? []) {
        if (visitedChunkIds[String(nextChunkId)] === true) {
          continue;
        }

        visitedChunkIds[String(nextChunkId)] = true;
        stack.push(nextChunkId);
      }
    }

    component.sort(compareNumber);
    components.push(component);
  }

  components.sort((left, right) => {
    const leftMinChunkId = left[0] ?? Number.POSITIVE_INFINITY;
    const rightMinChunkId = right[0] ?? Number.POSITIVE_INFINITY;

    return leftMinChunkId - rightMinChunkId;
  });

  return components;
}

export function isWeaklyConnected(graph: {
  readonly sortedChunkIds: readonly number[];
  readonly undirectedAdjacentChunkIdsByChunkId: Readonly<
    Record<string, readonly number[] | undefined>
  >;
}): boolean {
  const firstChunkId = graph.sortedChunkIds[0];

  if (firstChunkId === undefined) {
    return true;
  }

  const visitedChunkIds = createBooleanRecord();
  const stack = [firstChunkId];

  visitedChunkIds[String(firstChunkId)] = true;

  while (stack.length > 0) {
    const currentChunkId = stack.pop();

    if (currentChunkId === undefined) {
      continue;
    }

    for (const nextChunkId of graph.undirectedAdjacentChunkIdsByChunkId[
      String(currentChunkId)
    ] ?? []) {
      if (visitedChunkIds[String(nextChunkId)] === true) {
        continue;
      }

      visitedChunkIds[String(nextChunkId)] = true;
      stack.push(nextChunkId);
    }
  }

  return graph.sortedChunkIds.every(
    (chunkId) => visitedChunkIds[String(chunkId)] === true,
  );
}
