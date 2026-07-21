import type { Document, ReadonlyDocument } from "../../document/index.js";

export async function copySnakes(
  sourceDocument: ReadonlyDocument,
  targetDocument: Document,
  serialId: number,
  chunkIdMap: ReadonlyMap<number, number>,
): Promise<void> {
  const sourceSnakes = await sourceDocument.snakes.listBySerial(serialId);
  const snakeIdMap = new Map<number, number>();

  for (const sourceSnake of sourceSnakes) {
    const targetSnakeId = await targetDocument.snakes.create({
      firstLabel: sourceSnake.firstLabel,
      groupId: sourceSnake.groupId,
      lastLabel: sourceSnake.lastLabel,
      localSnakeId: sourceSnake.localSnakeId,
      serialId,
      size: sourceSnake.size,
      weight: sourceSnake.weight,
      wordsCount: sourceSnake.wordsCount,
    });

    snakeIdMap.set(sourceSnake.id, targetSnakeId);

    for (const snakeChunk of await sourceDocument.snakeChunks.listBySnake(
      sourceSnake.id,
    )) {
      const chunkId = chunkIdMap.get(snakeChunk.chunkId);

      if (chunkId === undefined) {
        continue;
      }

      await targetDocument.snakeChunks.save({
        chunkId,
        position: snakeChunk.position,
        snakeId: targetSnakeId,
      });
    }
  }

  for (const edge of await sourceDocument.snakeEdges.listBySerial(serialId)) {
    const fromSnakeId = snakeIdMap.get(edge.fromSnakeId);
    const toSnakeId = snakeIdMap.get(edge.toSnakeId);

    if (fromSnakeId === undefined || toSnakeId === undefined) {
      continue;
    }

    await targetDocument.snakeEdges.save({
      fromSnakeId,
      toSnakeId,
      weight: edge.weight,
    });
  }
}

export async function copyChunks(
  sourceDocument: ReadonlyDocument,
  targetDocument: Document,
  serialId: number,
): Promise<ReadonlyMap<number, number>> {
  const chunkIdMap = new Map<number, number>();

  for (const chunk of await sourceDocument.chunks.listBySerial(serialId)) {
    const createdChunk = await targetDocument.chunks.create({
      content: chunk.content,
      generation: chunk.generation,
      label: chunk.label,
      sentenceId: chunk.sentenceId,
      sentenceIds: chunk.sentenceIds,
      weight: chunk.weight,
      wordsCount: chunk.wordsCount,
      ...(chunk.importance === undefined
        ? {}
        : { importance: chunk.importance }),
      ...(chunk.retention === undefined ? {} : { retention: chunk.retention }),
    });

    chunkIdMap.set(chunk.id, createdChunk.id);
  }

  return chunkIdMap;
}
