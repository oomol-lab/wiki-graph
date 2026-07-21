import {
  expectChunkImportance,
  type ChunkImportance,
} from "../../../../document/index.js";
import type { ChunkImportanceAnnotation } from "../types.js";
import { hasMembership } from "./helpers.js";

export function validateImportanceAnnotations(input: {
  readonly annotations: readonly {
    readonly chunk_id: number;
    readonly importance: ChunkImportance;
  }[];
  readonly issues: string[];
  readonly validImportanceChunkIds: Readonly<Record<string, true>> | undefined;
}): ChunkImportanceAnnotation[] | undefined {
  const { annotations, issues, validImportanceChunkIds } = input;
  if (annotations.length === 0) {
    return [];
  }

  if (validImportanceChunkIds === undefined) {
    return annotations.map((annotation) => ({
      chunkId: annotation.chunk_id,
      importance: expectChunkImportance(annotation.importance),
    }));
  }

  const result: ChunkImportanceAnnotation[] = [];

  for (const annotation of annotations) {
    if (!hasMembership(validImportanceChunkIds, annotation.chunk_id)) {
      issues.push(
        `importance_annotations references unknown chunk_id ${annotation.chunk_id}`,
      );
      continue;
    }

    result.push({
      chunkId: annotation.chunk_id,
      importance: expectChunkImportance(annotation.importance),
    });
  }

  return result;
}
