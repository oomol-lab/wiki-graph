import {
  CHAPTER_JOB_STREAM_CONTENT_TYPE,
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
    await writeResponseBody(response.body, artifactFile);
    return { artifactFile, revision };
  };
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
