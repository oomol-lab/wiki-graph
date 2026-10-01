import { access, mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createWikiGraphSDK,
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
});

async function readCoreLibraryIdentity(sdk: WikiGraphSDK): Promise<string> {
  return await sdk.core.digestTextStreamSession(
    { stream: [], targetStage: "planned", title: "Storage probe" },
    () => getWikiGraphStorage().library.identity,
  );
}
