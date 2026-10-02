import { mkdir } from "fs/promises";
import { dirname, join } from "path";

import { describe, expect, it } from "vitest";

import { createCLISandbox } from "./helpers/cli-sandbox.js";
import { enqueueJob, parseJSONL, waitForJob } from "./helpers/workflow.js";

describe("packed CLI library workflow", () => {
  it("creates a library registry and adds an archive through the CLI", async () => {
    const sandbox = await createCLISandbox("library-create-add");
    await createLibraryArchive(
      sandbox,
      dirname(sandbox.archivePath),
      "knowledge.wikg",
      {
        source: "A portable archive is ready to be copied into a library.",
        title: "Portable archive",
      },
    );
    const createdLibraryPath = join(sandbox.root, "created-library");
    const library = await sandbox.runJSON<{
      readonly folderPath: string;
      readonly isDefault: boolean;
      readonly uri: string;
    }>(["wikg://lib/registry", "add", "--path", createdLibraryPath, "--json"]);
    expect(library).toMatchObject({
      folderPath: createdLibraryPath,
      isDefault: false,
    });

    const added = await sandbox.runJSON<{
      readonly relativePath: string;
      readonly status: string;
      readonly uri: string;
    }>([
      `${library.uri}/arc`,
      "add",
      "--input",
      sandbox.archivePath,
      "--to",
      "nested/copied.wikg",
      "--json",
    ]);
    expect(added).toMatchObject({
      relativePath: "nested/copied.wikg",
      status: "present",
    });
    expect(added.uri).toMatch(new RegExp(`^${library.uri}/arc/`, "u"));

    const members = await sandbox.runJSON<{
      readonly items: readonly { readonly uri: string }[];
    }>([`${library.uri}/arc`, "--json"]);
    expect(members.items.map((item) => item.uri)).toContain(added.uri);
  });

  it("binds two archives, rebuilds the aggregate index, and queries both", async () => {
    const sandbox = await createCLISandbox("library-query");
    const libraryPath = join(dirname(sandbox.archivePath), "library");
    await mkdir(libraryPath, { recursive: true });

    const archives = [
      await createLibraryArchive(sandbox, libraryPath, "alpha.wikg", {
        source: "The shared nebula is observed from Alpha station.",
        title: "Alpha observations",
      }),
      await createLibraryArchive(sandbox, libraryPath, "beta.wikg", {
        source: "The shared nebula is catalogued by Beta station.",
        title: "Beta observations",
      }),
    ];
    const jobs = await Promise.all(
      archives.map(
        async (archive) =>
          await enqueueJob(sandbox, archive.chapterUri, "index-fts"),
      ),
    );
    const completed = await Promise.all(
      jobs.map(async (job) => await waitForJob(sandbox, job.jobId)),
    );
    expect(completed.map((job) => job.state)).toEqual([
      "succeeded",
      "succeeded",
    ]);

    const bound = await sandbox.runJSON<{
      readonly items: readonly Record<string, unknown>[];
    }>(["wikg://lib/path", "set", libraryPath, "--json"]);
    expect(bound.items).toHaveLength(2);

    const scan = await sandbox.runJSON<{
      readonly items: readonly Record<string, unknown>[];
    }>(["wikg://lib/arc", "scan", "--json"]);
    expect(scan.items).toHaveLength(2);

    await syncLibraryIndex(sandbox);
    await expectLibraryQueryToFindBoth(sandbox);

    const cleaned = await sandbox.runJSON<{ readonly status: string }>([
      "wikg://lib/index",
      "clean",
      "--json",
    ]);
    expect(cleaned.status).not.toBe("ready");

    const blocked = await sandbox.run([
      "wikg://lib/chapter",
      "--query",
      "shared nebula",
      "--json",
    ]);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stdout).toContain('"error"');

    await syncLibraryIndex(sandbox);
    await expectLibraryQueryToFindBoth(sandbox);
  });
});

async function createLibraryArchive(
  sandbox: Awaited<ReturnType<typeof createCLISandbox>>,
  libraryPath: string,
  filename: string,
  input: { readonly source: string; readonly title: string },
): Promise<{ readonly archiveUri: string; readonly chapterUri: string }> {
  const archivePath = join(libraryPath, filename);
  const archiveUri = `wikg://${archivePath}`;
  await sandbox.runJSON([archiveUri, "create", "--json"]);
  const chapter = await sandbox.runJSON<{ readonly locatedUri: string }>(
    [
      `${archiveUri}/chapter`,
      "add",
      "--title",
      input.title,
      "--input",
      "-",
      "--json",
    ],
    { input: input.source },
  );
  return { archiveUri, chapterUri: chapter.locatedUri };
}

async function syncLibraryIndex(
  sandbox: Awaited<ReturnType<typeof createCLISandbox>>,
): Promise<void> {
  const sync = await sandbox.run(["wikg://lib/index", "sync", "--jsonl"]);
  expect(sync.exitCode, sync.stderr).toBe(0);
  const events = parseJSONL(sync.stdout);
  expect(events.at(0)).toMatchObject({ type: "started" });
  expect(events.at(-1)).toMatchObject({ type: "succeeded" });
}

async function expectLibraryQueryToFindBoth(
  sandbox: Awaited<ReturnType<typeof createCLISandbox>>,
): Promise<void> {
  const results = await sandbox.runJSON<{
    readonly objects: readonly {
      readonly title?: string;
      readonly uri: string;
    }[];
  }>(["wikg://lib", "--query", "shared nebula", "--json"]);
  expect(results.objects.length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(results.objects)).toContain("Alpha station");
  expect(JSON.stringify(results.objects)).toContain("Beta station");
  expect(
    new Set(results.objects.map((item) => item.uri)).size,
  ).toBeGreaterThanOrEqual(2);
}
