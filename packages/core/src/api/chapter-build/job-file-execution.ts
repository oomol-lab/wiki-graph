import {
  CHAPTER_JOB_EVENT_STREAM_CONTENT_TYPE,
  CHAPTER_JOB_STREAM_CONTENT_TYPE,
  parseChapterJobStreamEvent,
  type ChapterJobFileExecutionOptions,
  type ChapterJobFileExecutor,
  type ChapterJobFileResult,
  type JobFile,
} from "wiki-graph-job";

const REVISION_HEADER = "X-Wiki-Graph-Revision";

export function createRemoteChapterJobFileExecutor(options: {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly token?: string;
}): ChapterJobFileExecutor {
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  const request = options.fetch ?? globalThis.fetch;
  return async (
    execution: ChapterJobFileExecutionOptions,
  ): Promise<ChapterJobFileResult> => {
    if ((await execution.workspace.list()).length !== 0) {
      throw new Error("Chapter job workspace must be empty.");
    }
    const response = await request(`${baseUrl}/v1/jobs/${execution.kind}`, {
      body: createFileBody(execution.inputFile),
      duplex: "half",
      headers: {
        ...(options.token === undefined
          ? {}
          : { Authorization: `Bearer ${options.token}` }),
        "Content-Type": CHAPTER_JOB_STREAM_CONTENT_TYPE,
        [REVISION_HEADER]: String(execution.revision),
      },
      method: "POST",
      ...(execution.signal === undefined ? {} : { signal: execution.signal }),
    } as RequestInit & { readonly duplex: "half" });
    if (!response.ok) {
      throw new Error(
        `Chapter job service returned ${response.status}: ${await response.text()}`,
      );
    }
    if (response.body === null) {
      throw new Error("Chapter job service returned an empty response body.");
    }
    const revision = parseResponseRevision(
      response.headers.get(REVISION_HEADER),
    );
    if (revision !== execution.revision) {
      throw new Error(
        `Chapter job service returned revision ${revision}; expected ${execution.revision}.`,
      );
    }
    const artifactFile = await execution.workspace.createFile("artifact.jsonl");
    if (isEventStream(response.headers.get("Content-Type"))) {
      const completedRevision = await writeEventResponseBody(
        response.body,
        artifactFile,
        execution.progress,
      );
      if (completedRevision !== revision) {
        throw new Error(
          `Chapter job stream completed revision ${completedRevision}; expected ${revision}.`,
        );
      }
    } else {
      await writeResponseBody(response.body, artifactFile);
    }
    return { artifactFile, revision };
  };
}

function isEventStream(contentType: string | null): boolean {
  return (
    contentType
      ?.toLowerCase()
      .startsWith(CHAPTER_JOB_EVENT_STREAM_CONTENT_TYPE.split(";")[0] ?? "") ===
    true
  );
}

function createFileBody(file: JobFile): ReadableStream<Uint8Array> {
  let reader: Awaited<ReturnType<JobFile["openReader"]>> | undefined;
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async cancel() {
      await reader?.close();
      reader = undefined;
    },
    async pull(controller) {
      reader ??= await file.openReader();
      if (offset >= reader.size) {
        await reader.close();
        reader = undefined;
        controller.close();
        return;
      }
      const chunk = await reader.read(
        offset,
        Math.min(64 * 1024, reader.size - offset),
      );
      if (chunk.byteLength === 0) {
        controller.error(
          new Error("Unexpected end of chapter job input file."),
        );
        return;
      }
      offset += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
}

async function writeResponseBody(
  body: ReadableStream<Uint8Array>,
  file: JobFile,
): Promise<void> {
  const reader = body.getReader();
  const writer = await file.openWriter();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      await writer.write(chunk.value);
    }
    await writer.commit();
  } catch (error) {
    await writer.abort();
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function writeEventResponseBody(
  body: ReadableStream<Uint8Array>,
  file: JobFile,
  progress: ChapterJobFileExecutionOptions["progress"],
): Promise<number> {
  const reader = body.getReader();
  const writer = await file.openWriter();
  const decoder = new TextDecoder();
  let pending = "";
  let completedRevision: number | undefined;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      while (true) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line !== "") {
          completedRevision = await consumeEventLine(
            line,
            writer,
            progress,
            completedRevision,
          );
        }
      }
    }
    pending += decoder.decode();
    if (pending.trim() !== "") {
      completedRevision = await consumeEventLine(
        pending.trim(),
        writer,
        progress,
        completedRevision,
      );
    }
    if (completedRevision === undefined) {
      throw new Error("Chapter job event stream ended without completion.");
    }
    await writer.commit();
    return completedRevision;
  } catch (error) {
    await writer.abort();
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function consumeEventLine(
  line: string,
  writer: Awaited<ReturnType<JobFile["openWriter"]>>,
  progress: ChapterJobFileExecutionOptions["progress"],
  completedRevision: number | undefined,
): Promise<number | undefined> {
  if (completedRevision !== undefined) {
    throw new Error("Chapter job event stream continued after completion.");
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Chapter job service returned invalid event JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const event = parseChapterJobStreamEvent(value);
  switch (event.event) {
    case "output-characters":
      await progress?.addOutputCharacters?.(event.characters);
      return undefined;
    case "token-usage":
      await progress?.addTokenUsage?.(event.usage);
      return undefined;
    case "progress":
      await progress?.updatePhase?.({
        done: event.progress.done,
        ...(event.progress.force === undefined
          ? {}
          : { force: event.progress.force }),
        phase: event.progress.phase,
        ...(event.progress.phaseDetail === undefined
          ? {}
          : { phaseDetail: event.progress.phaseDetail }),
        total: event.progress.total,
        unit: event.progress.unit,
      });
      return undefined;
    case "artifact":
      await writer.write(`${JSON.stringify(event.record)}\n`);
      return undefined;
    case "complete":
      return event.revision;
    case "error":
      throw new Error(`Chapter job service failed: ${event.message}`);
  }
}

function parseResponseRevision(value: string | null): number {
  if (value === null || !/^\d+$/u.test(value)) {
    throw new Error(`Chapter job service omitted a valid ${REVISION_HEADER}.`);
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw new Error(
      `Chapter job service returned an invalid ${REVISION_HEADER}.`,
    );
  }
  return revision;
}
