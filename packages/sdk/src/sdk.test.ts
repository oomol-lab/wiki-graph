import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import { createWikiGraphSDK, WikiGraphSDK } from "./index.js";

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
});
