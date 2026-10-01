import { access, mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createWikiGraphSDK,
  getNodeResourcePath,
  getWikiGraphStorage,
  NodeDirectory,
  WikiGraphSDK,
} from "./index.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(
        async (directory) =>
          await rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe("WikiGraphSDK", () => {
  it("provides typed managers without exposing a command executor", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-"));
    tempDirectories.push(stateDir);
    const sdk = createWikiGraphSDK({ stateDir });

    expect(sdk).toBeInstanceOf(WikiGraphSDK);
    expect("execute" in sdk).toBe(false);
    expect(typeof sdk.jobs.create).toBe("function");
    expect(typeof sdk.libraries.list).toBe("function");

    await expect(sdk.config.put("concurrent", "job", 3)).resolves.toEqual({
      job: 3,
    });
    sdk.close();

    const reopened = createWikiGraphSDK({ stateDir });
    await expect(reopened.config.get("concurrent")).resolves.toEqual({
      job: 3,
    });
    reopened.close();
  });

  it("binds each public core instance to its own state directory", async () => {
    const firstStateDir = await mkdtemp(
      join(tmpdir(), "wiki-graph-sdk-first-"),
    );
    const secondStateDir = await mkdtemp(
      join(tmpdir(), "wiki-graph-sdk-second-"),
    );
    tempDirectories.push(firstStateDir, secondStateDir);
    const first = createWikiGraphSDK({ stateDir: firstStateDir });
    const second = createWikiGraphSDK({ stateDir: secondStateDir });

    const [firstLibrary, secondLibrary] = await Promise.all([
      readCoreLibraryIdentity(first),
      readCoreLibraryIdentity(second),
    ]);

    expect(firstLibrary).toBe(new NodeDirectory(firstStateDir).identity);
    expect(secondLibrary).toBe(new NodeDirectory(secondStateDir).identity);
    expect(firstLibrary).not.toBe(secondLibrary);
    first.close();
    second.close();
  });

  it("isolates conversion cwd and config state across concurrent instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-isolation-"));
    const firstCwd = join(root, "first-cwd");
    const secondCwd = join(root, "second-cwd");
    const firstStateDir = join(root, "first-state");
    const secondStateDir = join(root, "second-state");
    tempDirectories.push(root);
    await Promise.all([
      mkdir(firstCwd, { recursive: true }),
      mkdir(secondCwd, { recursive: true }),
      mkdir(firstStateDir, { recursive: true }),
      mkdir(secondStateDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(firstCwd, "source.txt"), "First document"),
      writeFile(join(secondCwd, "source.txt"), "Second document"),
    ]);
    const first = createWikiGraphSDK({
      cwd: firstCwd,
      stateDir: firstStateDir,
    });
    const second = createWikiGraphSDK({
      cwd: secondCwd,
      stateDir: secondStateDir,
    });

    const [firstResult, secondResult] = await Promise.all([
      Promise.all([
        first.config.put("concurrent", "job", 1),
        first.conversions.convert({
          input: { format: "txt", path: "source.txt" },
          output: { format: "wikg", path: "result.wikg" },
          targetStage: "planned",
        }),
      ]),
      Promise.all([
        second.config.put("concurrent", "job", 2),
        second.conversions.convert({
          input: { format: "txt", path: "source.txt" },
          output: { format: "wikg", path: "result.wikg" },
          targetStage: "planned",
        }),
      ]),
    ]);

    expect(firstResult[1].outputPath).toBe("result.wikg");
    expect(secondResult[1].outputPath).toBe("result.wikg");
    await expect(
      access(join(firstCwd, "result.wikg")),
    ).resolves.toBeUndefined();
    await expect(
      access(join(secondCwd, "result.wikg")),
    ).resolves.toBeUndefined();
    await expect(first.config.get("concurrent")).resolves.toEqual({ job: 1 });
    await expect(second.config.get("concurrent")).resolves.toEqual({ job: 2 });
    first.close();
    second.close();
  });

  it("resolves library and job paths within each configured cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-manager-paths-"));
    const firstCwd = join(root, "first-cwd");
    const secondCwd = join(root, "second-cwd");
    const firstStateDir = join(root, "first-state");
    const secondStateDir = join(root, "second-state");
    tempDirectories.push(root);
    await Promise.all(
      [firstCwd, secondCwd, firstStateDir, secondStateDir].map(
        async (path) => await mkdir(path, { recursive: true }),
      ),
    );
    const first = createWikiGraphSDK({
      cwd: firstCwd,
      stateDir: firstStateDir,
    });
    const second = createWikiGraphSDK({
      cwd: secondCwd,
      stateDir: secondStateDir,
    });
    const [firstLibrary, secondLibrary] = await Promise.all([
      first.libraries.create("library"),
      second.libraries.create("library"),
    ]);
    await Promise.all([
      first.archives.create({ path: "book.wikg" }),
      second.archives.create({ path: "book.wikg" }),
    ]);
    const [firstChapter, secondChapter] = await Promise.all([
      (await first.archives.open("book.wikg")).addChapter({ source: "First" }),
      (await second.archives.open("book.wikg")).addChapter({
        source: "Second",
      }),
    ]);
    const [firstJob, secondJob] = await Promise.all([
      first.jobs.create({
        archive: "book.wikg",
        chapterId: firstChapter.chapterId,
        target: "index-fts",
      }),
      second.jobs.create({
        archive: "book.wikg",
        chapterId: secondChapter.chapterId,
        target: "index-fts",
      }),
    ]);

    await expect(access(join(firstCwd, "library"))).resolves.toBeUndefined();
    await expect(access(join(secondCwd, "library"))).resolves.toBeUndefined();
    expect(getNodeResourcePath(firstJob.snapshot.archive)).toBe(
      join(firstCwd, "book.wikg"),
    );
    expect(getNodeResourcePath(secondJob.snapshot.archive)).toBe(
      join(secondCwd, "book.wikg"),
    );
    const firstJobs = await first.jobs.list({ all: true });
    const secondJobs = await second.jobs.list({ all: true });
    expect(firstJobs.map((job) => job.id)).toContain(firstJob.id);
    expect(secondJobs.map((job) => job.id)).toContain(secondJob.id);
    expect(
      (await first.jobs.list({ all: true, archive: "book.wikg" })).map(
        (job) => job.id,
      ),
    ).toContain(firstJob.id);
    expect(
      (await second.jobs.list({ all: true, archive: "book.wikg" })).map(
        (job) => job.id,
      ),
    ).toContain(secondJob.id);
    const [firstMember, secondMember] = await Promise.all([
      first.libraries.addArchive({
        inputPath: "book.wikg",
        target: firstLibrary.uri,
        to: "member.wikg",
      }),
      second.libraries.addArchive({
        inputPath: "book.wikg",
        target: secondLibrary.uri,
        to: "member.wikg",
      }),
    ]);
    expect(getNodeResourcePath(firstMember.file!)).toBe(
      join(firstCwd, "library", "member.wikg"),
    );
    expect(getNodeResourcePath(secondMember.file!)).toBe(
      join(secondCwd, "library", "member.wikg"),
    );
    await Promise.all([
      mkdir(join(firstCwd, "rebound")),
      mkdir(join(secondCwd, "rebound")),
    ]);
    await Promise.all([
      first.libraries.rebind(firstLibrary.uri, "rebound"),
      second.libraries.rebind(secondLibrary.uri, "rebound"),
    ]);
    expect(
      getNodeResourcePath(
        (await first.libraries.get(firstLibrary.uri)).snapshot.folder,
      ),
    ).toBe(join(firstCwd, "rebound"));
    expect(
      getNodeResourcePath(
        (await second.libraries.get(secondLibrary.uri)).snapshot.folder,
      ),
    ).toBe(join(secondCwd, "rebound"));
    await expect(access(join(process.cwd(), "library"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    first.close();
    second.close();
  });
});

async function readCoreLibraryIdentity(sdk: WikiGraphSDK): Promise<string> {
  return await sdk.core.digestTextStreamSession(
    { stream: [], targetStage: "planned", title: "Storage probe" },
    () => getWikiGraphStorage().library.identity,
  );
}
