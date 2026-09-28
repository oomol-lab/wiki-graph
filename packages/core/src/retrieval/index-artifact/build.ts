import type {
  Document,
  ReadonlyDocument,
  ReplaceEmbeddingIndexArtifactInput,
  ReplaceFtsIndexArtifactInput,
  SentenceRecord,
} from "../../document/index.js";
import {
  buildEmbeddingJobArtifact,
  buildFtsJobArtifact,
  CHAPTER_JOB_PROTOCOL,
} from "wiki-graph-job";
import type { TocItem } from "../../text/source/index.js";
import {
  type SearchIndexEmbeddingProvider,
} from "../search-index/index.js";

export type EmbeddingIndexArtifactKind =
  | "embedding-source"
  | "embedding-summary";

export async function replaceChapterFtsIndexArtifact(
  document: Document,
  serialId: number,
): Promise<void> {
  const artifact = await buildChapterFtsIndexArtifact(document, serialId);

  await document.indexArtifacts.replaceFts(artifact);
}

export async function refreshChapterFtsIndexArtifactIfPresent(
  document: Document,
  serialId: number,
): Promise<void> {
  if ((await document.indexArtifacts.get(serialId, "fts")) === undefined) {
    return;
  }

  await replaceChapterFtsIndexArtifact(document, serialId);
}

export async function replaceChapterSourceEmbeddingIndexArtifact(
  document: Document,
  serialId: number,
  embeddingProvider: SearchIndexEmbeddingProvider,
): Promise<void> {
  const artifact = await buildChapterEmbeddingIndexArtifact(document, {
    embeddingProvider,
    kind: "embedding-source",
    serialId,
  });

  await document.indexArtifacts.replaceEmbedding(artifact);
}

export async function replaceChapterSummaryEmbeddingIndexArtifact(
  document: Document,
  serialId: number,
  embeddingProvider: SearchIndexEmbeddingProvider,
): Promise<void> {
  const artifact = await buildChapterEmbeddingIndexArtifact(document, {
    embeddingProvider,
    kind: "embedding-summary",
    serialId,
  });

  await document.indexArtifacts.replaceEmbedding(artifact);
}

export async function buildChapterFtsIndexArtifact(
  document: ReadonlyDocument,
  serialId: number,
): Promise<ReplaceFtsIndexArtifactInput> {
  const sourceRevision = await document.serials.getRevision(serialId);
  const sentences = await listTextStreamSentences(
    document.getSerialFragments(serialId),
  );
  const summarySentences = await listTextStreamSentences(
    document.getSummaryFragments(serialId),
  );

  return createFtsIndexArtifactInput({
    chapterTitles: await readChapterTitles(document, serialId),
    chunks: await document.chunks.listBySerial(serialId),
    mentions: await document.mentions.listByChapter(serialId),
    sentences,
    serialId,
    sourceRevision,
    summarySentences,
  });
}

export function createFtsIndexArtifactInput(input: {
  readonly chapterTitles?: readonly {
    readonly id: number;
    readonly title: string;
  }[];
  readonly chunks?: readonly {
    readonly content: string;
    readonly id: number;
    readonly label: string;
    readonly wordsCount: number;
  }[];
  readonly mentions?: readonly {
    readonly id: string;
    readonly qid: string;
    readonly surface: string;
  }[];
  readonly sentences: readonly SentenceRecord[];
  readonly serialId: number;
  readonly sourceRevision: number;
  readonly summarySentences?: readonly SentenceRecord[];
}): ReplaceFtsIndexArtifactInput {
  const artifact = buildFtsJobArtifact({
    chapterId: input.serialId,
    kind: "index-fts",
    payload: {
      chapterTitles: input.chapterTitles ?? [],
      chunks: input.chunks ?? [],
      mentions: input.mentions ?? [],
      sentences: input.sentences,
      summarySentences: input.summarySentences ?? [],
    },
    protocol: CHAPTER_JOB_PROTOCOL,
    revision: input.sourceRevision,
  });

  return {
    lexicalRows: artifact.payload.lexicalRows,
    metadata: artifact.payload.metadata,
    serialId: artifact.chapterId,
    sourceRevision: artifact.revision,
  };
}

export async function buildChapterEmbeddingIndexArtifact(
  document: ReadonlyDocument,
  input: {
    readonly embeddingProvider: SearchIndexEmbeddingProvider;
    readonly kind: EmbeddingIndexArtifactKind;
    readonly serialId: number;
  },
): Promise<ReplaceEmbeddingIndexArtifactInput> {
  const sourceRevision = await document.serials.getRevision(input.serialId);
  const sentences =
    input.kind === "embedding-source"
      ? await listTextStreamSentences(
          document.getSerialFragments(input.serialId),
        )
      : await listTextStreamSentences(
          document.getSummaryFragments(input.serialId),
        );
  return await createEmbeddingIndexArtifactInput({
    embeddingProvider: input.embeddingProvider,
    kind: input.kind,
    sentences,
    serialId: input.serialId,
    sourceRevision,
  });
}

export async function createEmbeddingIndexArtifactInput(input: {
  readonly embeddingProvider: SearchIndexEmbeddingProvider;
  readonly kind: EmbeddingIndexArtifactKind;
  readonly sentences: readonly SentenceRecord[];
  readonly serialId: number;
  readonly signal?: AbortSignal;
  readonly sourceRevision: number;
}): Promise<ReplaceEmbeddingIndexArtifactInput> {
  const artifact = await buildEmbeddingJobArtifact(
    {
      chapterId: input.serialId,
      kind:
        input.kind === "embedding-source"
          ? "index-embedding-source"
          : "index-embedding-summary",
      payload: { sentences: input.sentences },
      protocol: CHAPTER_JOB_PROTOCOL,
      revision: input.sourceRevision,
    },
    input.embeddingProvider,
    input.signal,
  );

  return {
    kind: artifact.payload.kind,
    metadata: artifact.payload.metadata,
    segments: artifact.payload.segments,
    serialId: artifact.chapterId,
    sourceRevision: artifact.revision,
  };
}

async function listTextStreamSentences(stream: {
  readonly listSentences?: () => Promise<readonly SentenceRecord[]>;
}): Promise<readonly SentenceRecord[]> {
  if (stream.listSentences === undefined) {
    throw new Error("Text stream does not expose sentence listing.");
  }

  return await stream.listSentences();
}

async function readChapterTitles(
  document: ReadonlyDocument,
  serialId: number,
): Promise<readonly { readonly id: number; readonly title: string }[]> {
  const toc = await readDocumentToc(document);
  if (toc === undefined) {
    return [];
  }

  const items = collectTocItems(toc.items);
  const chapter = items.find((item) => item.serialId === serialId);

  if (chapter === undefined || typeof chapter.title !== "string") {
    return [];
  }

  return [{ id: serialId, title: chapter.title }];
}

async function readDocumentToc(
  document: ReadonlyDocument,
): Promise<{ readonly items: readonly TocItem[] } | undefined> {
  const reader = document as ReadonlyDocument & {
    readonly readToc?: () => Promise<
      { readonly items: readonly TocItem[] } | undefined
    >;
  };

  return await reader.readToc?.();
}

function collectTocItems(items: readonly TocItem[]): readonly TocItem[] {
  return items.flatMap((item) => [item, ...collectTocItems(item.children)]);
}
