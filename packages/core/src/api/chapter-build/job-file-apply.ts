import {
  readChapterJobArtifact,
  type ChapterJobArtifactRecord,
  type ChapterJobKind,
  type JobFile,
} from "wiki-graph-job";

import type {
  Document,
  IndexArtifactEmbeddingSegment,
  IndexArtifactLexicalRow,
} from "../../document/index.js";

export async function applyChapterJobArtifactFile(
  document: Document,
  chapterId: number,
  kind: ChapterJobKind,
  revision: number,
  artifactFile: JobFile,
): Promise<void> {
  const currentRevision = await document.serials.getRevision(chapterId);
  if (currentRevision !== revision) {
    throw new Error(
      `Chapter ${chapterId} changed from revision ${revision} to ${currentRevision}.`,
    );
  }

  switch (kind) {
    case "index-fts":
      await document.indexArtifacts.replaceFts({
        lexicalRows: readLexicalRows(artifactFile),
        metadata: { source: "chapter-lexical", version: 1 },
        serialId: chapterId,
        sourceRevision: revision,
      });
      return;
    case "index-embedding-source":
    case "index-embedding-summary": {
      const metadata = await readEmbeddingMetadata(artifactFile);
      await document.indexArtifacts.replaceEmbedding({
        kind:
          kind === "index-embedding-source"
            ? "embedding-source"
            : "embedding-summary",
        metadata: {
          dimensions: metadata.dimensions,
          ...(metadata.identity === undefined
            ? {}
            : { identity: metadata.identity }),
          model: metadata.model,
          version: metadata.version,
        },
        segments: readEmbeddingSegments(artifactFile),
        serialId: chapterId,
        sourceRevision: revision,
      });
      return;
    }
    default:
      throw new Error(`${kind} artifact apply is not implemented.`);
  }
}

async function* readLexicalRows(
  file: JobFile,
): AsyncIterable<IndexArtifactLexicalRow> {
  for await (const record of readChapterJobArtifact(file)) {
    if (record.type !== "lexical-row") continue;
    const { type: _, ...row } = record;
    yield row;
  }
}

async function* readEmbeddingSegments(
  file: JobFile,
): AsyncIterable<IndexArtifactEmbeddingSegment> {
  for await (const record of readChapterJobArtifact(file)) {
    if (record.type !== "embedding-segment") continue;
    const { type: _, ...segment } = record;
    yield segment;
  }
}

async function readEmbeddingMetadata(file: JobFile): Promise<
  Extract<ChapterJobArtifactRecord, { readonly type: "embedding-metadata" }>
> {
  for await (const record of readChapterJobArtifact(file)) {
    if (record.type === "embedding-metadata") return record;
  }
  throw new Error("Embedding artifact is missing its metadata record.");
}
