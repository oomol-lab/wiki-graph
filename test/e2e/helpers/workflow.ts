import { expect } from "vitest";

import type { CLISandbox } from "./cli-sandbox.js";

interface ChapterJSON {
  readonly chapterId: number;
  readonly locatedUri: string;
  readonly stage: string;
  readonly title: string;
  readonly uri: string;
}

interface JobJSON {
  readonly errorJSON?: string;
  readonly jobId: string;
  readonly state: string;
  readonly target: string;
}

export async function createSourcedArchive(
  sandbox: CLISandbox,
  options: { readonly source: string; readonly title: string },
): Promise<ChapterJSON> {
  const created = await sandbox.runJSON<{ readonly uri: string }>([
    sandbox.archiveUri,
    "create",
    "--json",
  ]);
  expect(created.uri).toBe(sandbox.archiveUri);

  const chapter = await sandbox.runJSON<ChapterJSON>(
    [
      `${sandbox.archiveUri}/chapter`,
      "add",
      "--title",
      options.title,
      "--input",
      "-",
      "--json",
    ],
    { input: options.source },
  );
  expect(chapter.locatedUri).toMatch(
    new RegExp(`^${escapeRegExp(sandbox.archiveUri)}/chapter/`, "u"),
  );
  expect(chapter.stage).toBe("source");
  return chapter;
}

export async function enqueueJob(
  sandbox: CLISandbox,
  inputUri: string,
  target: string,
  options: { readonly acceptCost?: boolean; readonly llm?: unknown } = {},
): Promise<JobJSON> {
  const args = [
    "wikg://local/job",
    "add",
    "--input",
    inputUri,
    "--task",
    target,
    ...(options.acceptCost === true ? ["--accept-cost"] : []),
    ...(options.llm === undefined
      ? []
      : ["--llm", JSON.stringify(options.llm)]),
    "--json",
  ];
  const job = await sandbox.runJSON<JobJSON>(args);
  expect(job.jobId).toMatch(/^[0-9a-f-]+$/u);
  expect(job.target).toBe(target);
  return job;
}

export async function waitForJob(
  sandbox: CLISandbox,
  jobId: string,
  timeoutMs = 60_000,
): Promise<JobJSON> {
  const deadline = Date.now() + timeoutMs;
  let latest: JobJSON | undefined;

  while (Date.now() < deadline) {
    latest = await sandbox.runJSON<JobJSON>([
      `wikg://local/job/${jobId}`,
      "--json",
    ]);
    if (["canceled", "failed", "succeeded"].includes(latest.state)) {
      return latest;
    }
    await delay(100);
  }

  throw new Error(
    `Job ${jobId} did not finish within ${timeoutMs}ms. Last state: ${JSON.stringify(latest)}`,
  );
}

export function parseJSONL(text: string): readonly Record<string, unknown>[] {
  return text
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
