import { describe, expect, it } from "vitest";
import { dirname, join } from "path";

import { createCLISandbox, resolveFixturePath } from "./helpers/cli-sandbox.js";
import { parseJSONL } from "./helpers/workflow.js";

describe("packed CLI import and conversion workflows", () => {
  it("imports a real EPUB, pages its chapters, and transforms the archive", async () => {
    const sandbox = await createCLISandbox("epub-import");
    const imported = await sandbox.runJSON<{ readonly uri: string }>([
      sandbox.archiveUri,
      "create",
      "--import",
      resolveFixturePath("sources/sample-observatory-guide.epub"),
      "--json",
    ]);
    expect(imported.uri).toBe(sandbox.archiveUri);

    const firstPage = await sandbox.runJSON<{
      readonly nextCursor: string | null;
      readonly objects: readonly {
        readonly uri: string;
        readonly title: string;
      }[];
    }>([`${sandbox.archiveUri}/chapter`, "--limit", "1", "--json"]);
    expect(firstPage.objects).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await sandbox.runJSON<{
      readonly objects: readonly { readonly uri: string }[];
    }>(["next", firstPage.nextCursor!, "--json"]);
    expect(secondPage.objects.length).toBeGreaterThan(0);
    expect(secondPage.objects[0]?.uri).not.toBe(firstPage.objects[0]?.uri);

    const chapterStream = await sandbox.run([
      `${sandbox.archiveUri}/chapter`,
      "--all",
      "--jsonl",
    ]);
    expect(chapterStream.exitCode, chapterStream.stderr).toBe(0);
    const chapterRecords = parseJSONL(chapterStream.stdout);
    expect(
      chapterRecords.filter((record) => record.type !== "page").length,
    ).toBeGreaterThan(1);

    const source = await sandbox.run([
      `${locateChapterUri(sandbox.archiveUri, firstPage.objects[0]!.uri)}/source`,
    ]);
    expect(source.exitCode, source.stderr).toBe(0);
    expect(source.stdout.length).toBeGreaterThan(20);

    const inspect = await sandbox.runJSON<{
      readonly content: {
        readonly chapters: { readonly content: number; readonly total: number };
      };
    }>([sandbox.archiveUri, "inspect", "--json"]);
    expect(inspect.content.chapters.content).toBeGreaterThan(1);
    expect(inspect.content.chapters.total).toBeGreaterThan(1);

    const exported = await sandbox.run([
      sandbox.archiveUri,
      "export",
      "--output-format",
      "markdown",
    ]);
    expect(exported.exitCode).not.toBe(0);
    expect(exported.stdout).toBe("");
    expect(exported.stderr).toContain("summary is missing");
    expect(exported.stderr).toContain("--task reading-summary");

    const transformedPath = join(
      dirname(sandbox.archivePath),
      "transformed.wikg",
    );
    const transformed = await sandbox.run([
      "transform",
      "--input",
      resolveFixturePath("sources/sample-observatory-guide.txt"),
      "--output",
      transformedPath,
      "--stage",
      "source",
    ]);
    expect(transformed.exitCode, transformed.stderr).toBe(0);
    expect(transformed.stdout).toBe("");

    const transformedInspect = await sandbox.runJSON<{
      readonly content: {
        readonly chapters: { readonly content: number; readonly total: number };
      };
    }>([`wikg://${transformedPath}`, "inspect", "--json"]);
    expect(transformedInspect.content.chapters).toMatchObject({
      content: 1,
      total: 1,
    });
  });
});

function locateChapterUri(archiveUri: string, objectUri: string): string {
  return `${archiveUri}/${objectUri
    .slice("wikg://".length)
    .replace(/\/title$/u, "")}`;
}
