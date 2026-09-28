import {
  CHAPTER_JOB_PROTOCOL,
  createChapterJobExecutor,
  type ChapterJobArtifact,
  type ChapterJobExecutor,
  type ChapterJobSnapshot,
  type JobEmbeddingProvider,
  type JobObject,
} from "wiki-graph-job";

import type { LLM } from "../../external/llm/index.js";
import type { GuaranteedRequestController } from "../../external/guaranteed/index.js";
import type { WikimediaResolver } from "../../external/wikipage/index.js";
import type { MatchWikispineSentenceCandidatesOptions } from "../../external/wikimatch/index.js";
import type { WikiGraphScope } from "../../runtime/common/llm-scope.js";
import {
  ensureRelativeFile,
  type Directory,
} from "../../runtime/platform/index.js";
import {
  buildChapterGraphArtifact,
  type BuildChapterGraphArtifactOptions,
} from "../../graph/reading-build/index.js";
import { generateChapterKnowledgeGraphArtifactFromSnapshot } from "../../graph/knowledge-build/index.js";
import { buildChapterSummaryArtifactFromReadingGraphObjects } from "../../text/summary-build/index.js";
import {
  readWikgObjectsFromJsonl,
  type WikgObject,
  writeWikgObjectsToJsonl,
} from "../../object-stream.js";

export interface LocalChapterJobExecutorOptions {
  readonly embeddingProvider?: JobEmbeddingProvider;
  readonly llm: LLM<WikiGraphScope>;
  readonly progressTracker?: BuildChapterGraphArtifactOptions["progressTracker"];
  readonly request: GuaranteedRequestController;
  readonly signal?: AbortSignal;
  readonly wikimediaResolver: WikimediaResolver;
  readonly wikispine?: Pick<
    MatchWikispineSentenceCandidatesOptions,
    "command" | "commandRunner" | "dataDir" | "endpoint" | "provider"
  >;
  readonly workspace: Directory;
}

export function createLocalChapterJobExecutor(
  options: LocalChapterJobExecutorOptions,
): ChapterJobExecutor {
  return createChapterJobExecutor({
    ...(options.embeddingProvider === undefined
      ? {}
      : { embeddingProvider: options.embeddingProvider }),
    knowledgeGraph: async (snapshot) =>
      await executeKnowledgeGraph(snapshot, options),
    readingGraph: async (snapshot) =>
      await executeReadingGraph(snapshot, options),
    readingSummary: async (snapshot) =>
      await executeReadingSummary(snapshot, options),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

async function executeReadingGraph(
  snapshot: ChapterJobSnapshot<"reading-graph">,
  options: LocalChapterJobExecutorOptions,
): Promise<ChapterJobArtifact<"reading-graph">> {
  const artifact = await buildChapterGraphArtifact(snapshot.chapterId, {
    ...(snapshot.payload.extractionPrompt === undefined
      ? {}
      : { extractionPrompt: snapshot.payload.extractionPrompt }),
    llm: options.llm,
    ...(options.progressTracker === undefined
      ? {}
      : { progressTracker: options.progressTracker }),
    sourceText: snapshot.payload.sourceText,
    workspace: options.workspace,
  });
  return {
    ...copyEnvelope(snapshot),
    payload: { objects: await collectObjects(artifact.objectsFile) },
  };
}

async function executeReadingSummary(
  snapshot: ChapterJobSnapshot<"reading-summary">,
  options: LocalChapterJobExecutorOptions,
): Promise<ChapterJobArtifact<"reading-summary">> {
  const file = await ensureRelativeFile(
    options.workspace,
    "reading-summary-input.jsonl",
  );
  await writeWikgObjectsToJsonl(
    file,
    snapshot.payload.readingGraph as readonly WikgObject[],
  );
  return {
    ...copyEnvelope(snapshot),
    payload: {
      summary: await buildChapterSummaryArtifactFromReadingGraphObjects(
        snapshot.chapterId,
        {
          llm: options.llm,
          readingGraphObjectsFile: file,
          workspace: options.workspace,
        },
      ),
    },
  };
}

async function executeKnowledgeGraph(
  snapshot: ChapterJobSnapshot<"knowledge-graph">,
  options: LocalChapterJobExecutorOptions,
): Promise<ChapterJobArtifact<"knowledge-graph">> {
  const artifact = await generateChapterKnowledgeGraphArtifactFromSnapshot(
    snapshot.chapterId,
    {
      details: {
        chapterId: snapshot.chapterId,
        childCount: 0,
        depth: 0,
        documentOrder: snapshot.chapterId,
        fragmentCount: snapshot.payload.fragments.length,
        graphReady: snapshot.payload.stage !== "sourced",
        hasSummary: snapshot.payload.stage === "summarized",
        key: String(snapshot.chapterId),
        path: String(snapshot.chapterId),
        stage: snapshot.payload.stage,
        title: null,
        tocPath: [],
        uri: `chapter:${snapshot.chapterId}`,
        words: snapshot.payload.fragments.reduce(
          (total, fragment) =>
            total +
            fragment.sentences.reduce(
              (subtotal, sentence) => subtotal + sentence.wordsCount,
              0,
            ),
          0,
        ),
      },
      fragments: snapshot.payload.fragments.map((fragment) => ({
        ...fragment,
        serialId: snapshot.chapterId,
      })),
    },
    {
      ...(snapshot.payload.language === undefined
        ? {}
        : { language: snapshot.payload.language }),
      ...(snapshot.payload.policyPrompt === undefined
        ? {}
        : { policyPrompt: snapshot.payload.policyPrompt }),
      request: options.request,
      wikimediaResolver: options.wikimediaResolver,
      ...(options.wikispine === undefined
        ? {}
        : { wikispine: options.wikispine }),
      workspace: options.workspace,
    },
  );
  return {
    ...copyEnvelope(snapshot),
    payload: { objects: await collectObjects(artifact.objectsFile) },
  };
}

async function collectObjects(
  file: Parameters<typeof readWikgObjectsFromJsonl>[0],
): Promise<readonly JobObject[]> {
  const objects: JobObject[] = [];
  for await (const object of readWikgObjectsFromJsonl(file)) {
    objects.push(object as JobObject);
  }
  return objects;
}

function copyEnvelope<K extends ChapterJobSnapshot["kind"]>(
  snapshot: ChapterJobSnapshot<K>,
): Pick<ChapterJobArtifact<K>, "chapterId" | "kind" | "protocol" | "revision"> {
  return {
    chapterId: snapshot.chapterId,
    kind: snapshot.kind,
    protocol: CHAPTER_JOB_PROTOCOL,
    revision: snapshot.revision,
  };
}
