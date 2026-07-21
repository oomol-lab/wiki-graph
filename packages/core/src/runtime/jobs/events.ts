import { appendFile, readFile } from "fs/promises";
import type { BuildJob, BuildJobEvent } from "./types.js";

export async function readBuildJobEvents(
  job: Pick<BuildJob, "eventsPath">,
): Promise<BuildJobEvent[]> {
  let content: string;

  try {
    content = await readFile(job.eventsPath, "utf8");
  } catch {
    return [];
  }

  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as BuildJobEvent);
}

export async function appendBuildJobEvent(
  job: Pick<BuildJob, "eventsPath" | "jobId">,
  event: BuildJobEvent,
): Promise<void> {
  const seq = (await readLastBuildJobEventSeq(job)) + 1;
  const nextEvent = {
    ...event,
    jobId: job.jobId,
    seq,
  };

  await appendFile(job.eventsPath, `${JSON.stringify(nextEvent)}\n`, "utf8");
}

async function readLastBuildJobEventSeq(
  job: Pick<BuildJob, "eventsPath">,
): Promise<number> {
  const events = await readBuildJobEvents(job);

  return events.at(-1)?.seq ?? 0;
}
