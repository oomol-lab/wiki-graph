import type {
  AnyChapterJobArtifact,
  AnyChapterJobSnapshot,
  ChapterJobArtifact,
  ChapterJobKind,
  ChapterJobSnapshot,
} from "./contracts.js";
import { buildEmbeddingJobArtifact, buildFtsJobArtifact } from "./index-build.js";
import type { JobEmbeddingProvider } from "./ports.js";
import {
  CHAPTER_JOB_STREAM_CONTENT_TYPE,
  decodeChapterJobArtifact,
  encodeChapterJobSnapshot,
  splitNdjson,
} from "./stream.js";

export interface ChapterJobExecutor {
  execute<K extends ChapterJobKind>(
    snapshot: ChapterJobSnapshot<K>,
  ): Promise<ChapterJobArtifact<K>>;
}

export interface ChapterJobHandlers {
  readonly embeddingProvider?: JobEmbeddingProvider;
  readonly knowledgeGraph: (
    snapshot: ChapterJobSnapshot<"knowledge-graph">,
  ) => Promise<ChapterJobArtifact<"knowledge-graph">>;
  readonly readingGraph: (
    snapshot: ChapterJobSnapshot<"reading-graph">,
  ) => Promise<ChapterJobArtifact<"reading-graph">>;
  readonly readingSummary: (
    snapshot: ChapterJobSnapshot<"reading-summary">,
  ) => Promise<ChapterJobArtifact<"reading-summary">>;
  readonly signal?: AbortSignal;
}

export function createChapterJobExecutor(
  handlers: ChapterJobHandlers,
): ChapterJobExecutor {
  return {
    async execute<K extends ChapterJobKind>(
      snapshot: ChapterJobSnapshot<K>,
    ): Promise<ChapterJobArtifact<K>> {
      return (await executeKnownJob(
        handlers,
        snapshot as AnyChapterJobSnapshot,
      )) as ChapterJobArtifact<K>;
    },
  };
}

export class HttpChapterJobExecutor implements ChapterJobExecutor {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #token: string | undefined;

  public constructor(options: {
    readonly baseUrl: string;
    readonly fetch?: typeof fetch;
    readonly token?: string;
  }) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#token = options.token;
  }

  public async execute<K extends ChapterJobKind>(
    snapshot: ChapterJobSnapshot<K>,
  ): Promise<ChapterJobArtifact<K>> {
    const requestInit: RequestInit & { readonly duplex: "half" } = {
      body: iterableBody(
        encodeChapterJobSnapshot(snapshot as AnyChapterJobSnapshot),
      ),
      duplex: "half",
      headers: {
        ...(this.#token === undefined
          ? {}
          : { Authorization: `Bearer ${this.#token}` }),
        "Content-Type": CHAPTER_JOB_STREAM_CONTENT_TYPE,
      },
      method: "POST",
    };
    const response = await this.#fetch(
      `${this.#baseUrl}/v1/jobs/${snapshot.kind}`,
      requestInit,
    );
    if (!response.ok) {
      throw new Error(
        `Chapter job service returned ${response.status}: ${await response.text()}`,
      );
    }
    if (response.body === null) {
      throw new Error("Chapter job service returned an empty response body.");
    }
    const artifact = await decodeChapterJobArtifact(
      splitNdjson(readableStreamChunks(response.body)),
    );
    if (
      artifact.kind !== snapshot.kind ||
      artifact.chapterId !== snapshot.chapterId ||
      artifact.revision !== snapshot.revision
    ) {
      throw new Error("Chapter job service returned an artifact for another job.");
    }
    return artifact as ChapterJobArtifact<K>;
  }
}

async function* readableStreamChunks(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function executeKnownJob(
  handlers: ChapterJobHandlers,
  snapshot: AnyChapterJobSnapshot,
): Promise<AnyChapterJobArtifact> {
  switch (snapshot.kind) {
    case "index-fts":
      return buildFtsJobArtifact(snapshot);
    case "index-embedding-source":
    case "index-embedding-summary":
      return await buildEmbeddingJobArtifact(
        snapshot,
        requireEmbeddingProvider(handlers.embeddingProvider),
        handlers.signal,
      );
    case "knowledge-graph":
      return await handlers.knowledgeGraph(snapshot);
    case "reading-graph":
      return await handlers.readingGraph(snapshot);
    case "reading-summary":
      return await handlers.readingSummary(snapshot);
  }
}

function requireEmbeddingProvider(
  provider: JobEmbeddingProvider | undefined,
): JobEmbeddingProvider {
  if (provider === undefined) {
    throw new Error("This chapter job executor has no embedding provider.");
  }
  return provider;
}

function iterableBody(lines: Iterable<string>): ReadableStream<Uint8Array> {
  const iterator = lines[Symbol.iterator]();
  const encoder = new TextEncoder();
  return new ReadableStream({
    pull(controller) {
      const next = iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next.value));
    },
  });
}
