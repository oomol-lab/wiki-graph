import { describe, expect, it } from "vitest";

import {
  assertSucceeded,
  createCLISandbox,
  readFixture,
} from "./helpers/cli-sandbox.js";
import {
  createSourcedArchive,
  enqueueJob,
  parseJSONL,
  waitForJob,
} from "./helpers/workflow.js";

describe("packed CLI FTS job", () => {
  it("starts the real detached worker and makes the archive searchable", async () => {
    const sandbox = await createCLISandbox("fts-worker");
    const chapter = await createSourcedArchive(sandbox, {
      source: await readFixture("sources/sample-observatory-guide.txt"),
      title: "Observatory guide",
    });
    const job = await enqueueJob(sandbox, chapter.locatedUri, "index-fts");

    const completed = await waitForJob(sandbox, job.jobId);
    expect(completed).toMatchObject({
      jobId: job.jobId,
      state: "succeeded",
      target: "index-fts",
    });

    const watch = await sandbox.run([
      `wikg://local/job/${job.jobId}`,
      "watch",
      "--jsonl",
      "--from",
      "beginning",
    ]);
    assertSucceeded(["job", "watch"], watch);
    const events = parseJSONL(watch.stdout);
    expect(events.map((event) => event.type)).toContain("started");
    expect(events.map((event) => event.type)).toContain("succeeded");

    const search = await sandbox.runJSON<{
      readonly objects: readonly {
        readonly text?: string;
        readonly type?: string;
        readonly uri: string;
      }[];
    }>([sandbox.archiveUri, "--query", "observatory", "--json"]);
    expect(search.objects.length).toBeGreaterThan(0);
    expect(search.objects[0]?.uri).toMatch(/^wikg:\/\//u);
    expect(JSON.stringify(search.objects[0]).toLowerCase()).toContain(
      "observatory",
    );

    const humanSearch = await sandbox.run([
      sandbox.archiveUri,
      "--query",
      "observatory",
    ]);
    expect(humanSearch.exitCode, humanSearch.stderr).toBe(0);
    expect(humanSearch.stdout.toLowerCase()).toContain("observatory");

    const cleaned = await sandbox.runJSON<{ readonly status: string }>([
      `${sandbox.archiveUri}/index`,
      "clean",
      "--json",
    ]);
    expect(cleaned.status).not.toBe("ready");
    const rebuiltSearch = await sandbox.runJSON<{
      readonly objects: readonly { readonly uri: string }[];
    }>([sandbox.archiveUri, "--query", "observatory", "--json"]);
    expect(rebuiltSearch.objects.length).toBeGreaterThan(0);

    const inspect = await sandbox.runJSON<{
      readonly coverage: {
        readonly ftsIndexArtifact: {
          readonly coveredChapters: number;
          readonly percent: string;
        };
      };
      readonly query: { readonly ready: boolean };
    }>([sandbox.archiveUri, "inspect", "--json"]);
    expect(inspect.query.ready).toBe(true);
    expect(inspect.coverage.ftsIndexArtifact).toMatchObject({
      coveredChapters: 1,
      percent: "100%",
    });
  });
});
