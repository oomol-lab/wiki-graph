import { access } from "fs/promises";

import { describe, expect, it } from "vitest";

import { createCLISandbox } from "./helpers/cli-sandbox.js";
import { createSourcedArchive } from "./helpers/workflow.js";

describe("packed CLI archive lifecycle", () => {
  it("creates, writes, inspects, and reads an isolated archive", async () => {
    const sandbox = await createCLISandbox("archive-lifecycle");
    const source =
      "The Meridian Observatory records the winter sky. Its brass telescope follows Orion.";
    const chapter = await createSourcedArchive(sandbox, {
      source,
      title: "Winter observations",
    });

    await expect(access(sandbox.archivePath)).resolves.toBeUndefined();
    const sourceResult = await sandbox.run([`${chapter.locatedUri}/source`]);
    expect(sourceResult).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `${source}\n`,
    });

    const inspect = await sandbox.runJSON<{
      readonly content: {
        readonly chapters: { readonly content: number; readonly total: number };
      };
      readonly uri: string;
    }>([sandbox.archiveUri, "inspect", "--json"]);
    expect(inspect).toMatchObject({ uri: sandbox.archiveUri });
    expect(inspect.content.chapters).toMatchObject({ content: 1, total: 1 });

    const chapters = await sandbox.runJSON<{
      readonly objects: readonly { readonly uri: string }[];
    }>([`${sandbox.archiveUri}/chapter`, "--depth", "0", "--json"]);
    expect(chapters.objects).toHaveLength(1);
    expect(chapters.objects[0]?.uri).toBe(`${chapter.uri}/title`);
  });

  it("starts from an empty home instead of reading another case's config", async () => {
    const first = await createCLISandbox("config-first");
    const second = await createCLISandbox("config-second");

    await first.runJSON([
      "wikg://local/config/concurrent",
      "put",
      "job",
      "7",
      "--json",
    ]);
    const firstConfig = await first.runJSON<Record<string, unknown>>([
      "wikg://local/config/concurrent",
      "--json",
    ]);
    const secondConfig = await second.runJSON<Record<string, unknown>>([
      "wikg://local/config/concurrent",
      "--json",
    ]);

    expect(firstConfig).toEqual({ job: 7 });
    expect(secondConfig).toEqual({});
  });
});
