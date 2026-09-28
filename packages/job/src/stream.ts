import type {
  AnyChapterJobArtifact,
  AnyChapterJobSnapshot,
  ChapterJobKind,
  ChapterJobSnapshotPayloads,
} from "./contracts.js";
import { CHAPTER_JOB_PROTOCOL } from "./contracts.js";

export const CHAPTER_JOB_STREAM_CONTENT_TYPE =
  "application/x-ndjson; charset=utf-8";

type SnapshotOptions =
  | Pick<
      ChapterJobSnapshotPayloads["knowledge-graph"],
      "language" | "policyPrompt" | "stage"
    >
  | Pick<ChapterJobSnapshotPayloads["reading-graph"], "extractionPrompt" | "language">
  | Pick<ChapterJobSnapshotPayloads["reading-summary"], "language" | "prompt">
  | Record<string, never>;

interface StreamStart<K extends ChapterJobKind> {
  readonly chapterId: number;
  readonly kind: K;
  readonly options: SnapshotOptions;
  readonly protocol: typeof CHAPTER_JOB_PROTOCOL;
  readonly revision: number;
  readonly type: "start";
}

interface StreamItem {
  readonly collection: string;
  readonly type: "item";
  readonly value: unknown;
}

interface StreamEnd {
  readonly type: "end";
}

type SnapshotFrame = StreamStart<ChapterJobKind> | StreamItem | StreamEnd;

interface ArtifactStart<K extends ChapterJobKind> {
  readonly chapterId: number;
  readonly kind: K;
  readonly metadata?: unknown;
  readonly protocol: typeof CHAPTER_JOB_PROTOCOL;
  readonly revision: number;
  readonly type: "start";
}

type ArtifactFrame = ArtifactStart<ChapterJobKind> | StreamItem | StreamEnd;

export function* encodeChapterJobSnapshot(
  snapshot: AnyChapterJobSnapshot,
): Iterable<string> {
  yield line(snapshotStart(snapshot));
  for (const item of snapshotItems(snapshot)) yield line(item);
  yield line({ type: "end" });
}

export async function decodeChapterJobSnapshot(
  lines: AsyncIterable<string>,
): Promise<AnyChapterJobSnapshot> {
  const frames = await readFrames(lines);
  const start = requireStart(frames);
  return createSnapshot(start, frames.slice(1, -1));
}

export function* encodeChapterJobArtifact(
  artifact: AnyChapterJobArtifact,
): Iterable<string> {
  yield line(artifactStart(artifact));
  for (const item of artifactItems(artifact)) yield line(item);
  yield line({ type: "end" });
}

export async function decodeChapterJobArtifact(
  lines: AsyncIterable<string>,
): Promise<AnyChapterJobArtifact> {
  const frames = await readFrames(lines);
  const start = requireArtifactStart(frames);
  return createArtifact(start, frames.slice(1, -1));
}

export async function* splitNdjson(
  chunks: AsyncIterable<Uint8Array | string>,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of chunks) {
    pending +=
      typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    while (true) {
      const newline = pending.indexOf("\n");
      if (newline < 0) break;
      const value = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (value !== "") yield value;
    }
  }
  pending += decoder.decode();
  if (pending.trim() !== "") yield pending.trim();
}

function snapshotStart(snapshot: AnyChapterJobSnapshot): SnapshotFrame {
  const options = (() => {
    switch (snapshot.kind) {
      case "knowledge-graph":
        return pick(snapshot.payload, ["language", "policyPrompt", "stage"]);
      case "reading-graph":
        return pick(snapshot.payload, ["extractionPrompt", "language"]);
      case "reading-summary":
        return pick(snapshot.payload, ["language", "prompt"]);
      default:
        return {};
    }
  })();
  return {
    chapterId: snapshot.chapterId,
    kind: snapshot.kind,
    options,
    protocol: snapshot.protocol,
    revision: snapshot.revision,
    type: "start",
  };
}

function* snapshotItems(snapshot: AnyChapterJobSnapshot): Iterable<StreamItem> {
  switch (snapshot.kind) {
    case "index-embedding-source":
    case "index-embedding-summary":
      yield* items("sentences", snapshot.payload.sentences);
      return;
    case "index-fts":
      yield* items("chapterTitles", snapshot.payload.chapterTitles);
      yield* items("chunks", snapshot.payload.chunks);
      yield* items("mentions", snapshot.payload.mentions);
      yield* items("sentences", snapshot.payload.sentences);
      yield* items("summarySentences", snapshot.payload.summarySentences);
      return;
    case "knowledge-graph":
      yield* items("fragments", snapshot.payload.fragments);
      return;
    case "reading-graph":
      yield* items("sourceText", snapshot.payload.sourceText);
      return;
    case "reading-summary":
      yield* items("readingGraph", snapshot.payload.readingGraph);
  }
}

function artifactStart(artifact: AnyChapterJobArtifact): ArtifactFrame {
  const metadata =
    artifact.kind === "index-fts" ||
    artifact.kind === "index-embedding-source" ||
    artifact.kind === "index-embedding-summary"
      ? artifact.payload.metadata
      : artifact.kind === "reading-summary"
        ? { summary: artifact.payload.summary }
        : undefined;
  return {
    chapterId: artifact.chapterId,
    kind: artifact.kind,
    ...(metadata === undefined ? {} : { metadata }),
    protocol: artifact.protocol,
    revision: artifact.revision,
    type: "start",
  };
}

function* artifactItems(artifact: AnyChapterJobArtifact): Iterable<StreamItem> {
  switch (artifact.kind) {
    case "index-embedding-source":
    case "index-embedding-summary":
      yield* items("segments", artifact.payload.segments);
      return;
    case "index-fts":
      yield* items("lexicalRows", artifact.payload.lexicalRows);
      return;
    case "knowledge-graph":
    case "reading-graph":
      yield* items("objects", artifact.payload.objects);
      return;
    case "reading-summary":
      return;
  }
}

function createSnapshot(
  start: StreamStart<ChapterJobKind>,
  frames: readonly SnapshotFrame[],
): AnyChapterJobSnapshot {
  const values = collect(frames);
  const base = {
    chapterId: start.chapterId,
    kind: start.kind,
    protocol: start.protocol,
    revision: start.revision,
  };
  switch (start.kind) {
    case "index-embedding-source":
    case "index-embedding-summary":
      return { ...base, payload: { sentences: values.sentences ?? [] } } as AnyChapterJobSnapshot;
    case "index-fts":
      return {
        ...base,
        payload: {
          chapterTitles: values.chapterTitles ?? [],
          chunks: values.chunks ?? [],
          mentions: values.mentions ?? [],
          sentences: values.sentences ?? [],
          summarySentences: values.summarySentences ?? [],
        },
      } as AnyChapterJobSnapshot;
    case "knowledge-graph":
      return {
        ...base,
        payload: { ...start.options, fragments: values.fragments ?? [] },
      } as AnyChapterJobSnapshot;
    case "reading-graph":
      return {
        ...base,
        payload: { ...start.options, sourceText: values.sourceText ?? [] },
      } as AnyChapterJobSnapshot;
    case "reading-summary":
      return {
        ...base,
        payload: { ...start.options, readingGraph: values.readingGraph ?? [] },
      } as AnyChapterJobSnapshot;
  }
}

function createArtifact(
  start: ArtifactStart<ChapterJobKind>,
  frames: readonly ArtifactFrame[],
): AnyChapterJobArtifact {
  const values = collect(frames);
  const base = {
    chapterId: start.chapterId,
    kind: start.kind,
    protocol: start.protocol,
    revision: start.revision,
  };
  switch (start.kind) {
    case "index-embedding-source":
    case "index-embedding-summary":
      return {
        ...base,
        payload: {
          kind:
            start.kind === "index-embedding-source"
              ? "embedding-source"
              : "embedding-summary",
          metadata: start.metadata,
          segments: values.segments ?? [],
        },
      } as AnyChapterJobArtifact;
    case "index-fts":
      return {
        ...base,
        payload: {
          lexicalRows: values.lexicalRows ?? [],
          metadata: start.metadata,
        },
      } as AnyChapterJobArtifact;
    case "knowledge-graph":
    case "reading-graph":
      return {
        ...base,
        payload: { objects: values.objects ?? [] },
      } as AnyChapterJobArtifact;
    case "reading-summary":
      return {
        ...base,
        payload: {
          summary: readSummary(start.metadata),
        },
      } as AnyChapterJobArtifact;
  }
}

async function readFrames(
  lines: AsyncIterable<string>,
): Promise<readonly SnapshotFrame[]> {
  const frames: SnapshotFrame[] = [];
  for await (const input of lines) {
    const frame: unknown = JSON.parse(input);
    if (!isFrame(frame)) throw new Error("Invalid chapter job stream frame.");
    frames.push(frame);
  }
  if (frames.length < 2 || frames.at(-1)?.type !== "end") {
    throw new Error("Incomplete chapter job stream.");
  }
  return frames;
}

function requireStart(
  frames: readonly SnapshotFrame[],
): StreamStart<ChapterJobKind> {
  const frame = frames[0];
  if (frame?.type !== "start" || !("options" in frame)) {
    throw new Error("Chapter job stream must start with a snapshot header.");
  }
  return frame;
}

function requireArtifactStart(
  frames: readonly SnapshotFrame[],
): ArtifactStart<ChapterJobKind> {
  const frame = frames[0];
  if (frame?.type !== "start") {
    throw new Error("Chapter job stream must start with an artifact header.");
  }
  return frame as ArtifactStart<ChapterJobKind>;
}

function isFrame(value: unknown): value is SnapshotFrame {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  if (value.type === "end") return true;
  if (value.type === "item") {
    return "collection" in value && typeof value.collection === "string";
  }
  return (
    value.type === "start" &&
    "protocol" in value &&
    value.protocol === CHAPTER_JOB_PROTOCOL &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "chapterId" in value &&
    typeof value.chapterId === "number" &&
    "revision" in value &&
    typeof value.revision === "number"
  );
}

function collect(
  frames: readonly (SnapshotFrame | ArtifactFrame)[],
): Record<string, unknown[]> {
  const values: Record<string, unknown[]> = {};
  for (const frame of frames) {
    if (frame.type !== "item") continue;
    (values[frame.collection] ??= []).push(frame.value);
  }
  return values;
}

function* items(collection: string, values: readonly unknown[]): Iterable<StreamItem> {
  for (const value of values) yield { collection, type: "item", value };
}

function pick<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const output: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (value[key] !== undefined) Object.assign(output, { [key]: value[key] });
  }
  return output;
}

function readSummary(metadata: unknown): string {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("summary" in metadata) ||
    typeof metadata.summary !== "string"
  ) {
    throw new Error("Reading Summary artifact is missing its summary.");
  }
  return metadata.summary;
}

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
