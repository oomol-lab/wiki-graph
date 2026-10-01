import { appendFileText, readFileText } from "../platform/index.js";
import type { BuildJob, BuildJobEvent } from "./types.js";

export async function readBuildJobEvents(
  job: Pick<BuildJob, "events">,
): Promise<BuildJobEvent[]> {
  let content: string;

  try {
    content = await readFileText(job.events);
  } catch {
    return [];
  }

  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as BuildJobEvent);
}

export interface BuildJobEventChunk {
  /** Byte offset to pass to the next incremental read. */
  readonly cursor: number;
  readonly events: readonly BuildJobEvent[];
}

/** Read only events appended after a prior byte cursor. */
export async function readBuildJobEventChunk(
  job: Pick<BuildJob, "events">,
  cursor = 0,
): Promise<BuildJobEventChunk> {
  let reader: Awaited<ReturnType<typeof job.events.openReader>>;
  try {
    reader = await job.events.openReader();
  } catch {
    return { cursor: 0, events: [] };
  }
  try {
    const offset = cursor <= reader.size ? cursor : 0;
    const bytes = await reader.read(offset, reader.size - offset);
    const content = new TextDecoder().decode(bytes);
    return {
      cursor: reader.size,
      events: content
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as BuildJobEvent),
    };
  } finally {
    await reader.close();
  }
}

export async function appendBuildJobEvent(
  job: Pick<BuildJob, "events" | "jobId">,
  event: BuildJobEvent,
): Promise<void> {
  const seq = (await readLastBuildJobEventSeq(job)) + 1;
  const nextEvent = {
    ...event,
    jobId: job.jobId,
    seq,
  };

  await appendFileText(job.events, `${JSON.stringify(nextEvent)}\n`);
}

async function readLastBuildJobEventSeq(
  job: Pick<BuildJob, "events">,
): Promise<number> {
  const events = await readBuildJobEvents(job);

  return events.at(-1)?.seq ?? 0;
}
