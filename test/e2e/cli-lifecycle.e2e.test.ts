import { access, readFile } from "fs/promises";

import { describe, expect, inject, it } from "vitest";

import { createCLISandbox } from "./helpers/cli-sandbox.js";
import { createSourcedArchive } from "./helpers/workflow.js";
import {
  NodeFile,
  nodeWikiGraphPlatform,
} from "../../packages/sdk/src/node-platform.js";

describe("packed CLI archive lifecycle", () => {
  it("blocks Home v4 without mutating it and recovers only through manual upgrade", async () => {
    const sandbox = await createCLISandbox("manual-home-upgrade");
    await sandbox.runJSON([sandbox.archiveUri, "create", "--json"]);
    const file = new NodeFile(`${sandbox.home}/.wikigraph/core.sqlite`);
    const database = await nodeWikiGraphPlatform.database.open(file, {
      mode: "readwrite",
      create: false,
    });
    try {
      await database.run(
        "UPDATE schema_versions SET version = 4 WHERE scope = 'home'",
      );
    } finally {
      await database.close();
    }
    const readVersion = async () => {
      const connection = await nodeWikiGraphPlatform.database.open(file, {
        mode: "readonly",
      });
      try {
        return (
          await connection.queryOne(
            "SELECT version FROM schema_versions WHERE scope = 'home'",
          )
        )?.version;
      } finally {
        await connection.close();
      }
    };
    const blocked = await sandbox.run([sandbox.archiveUri, "inspect"]);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain("maintenance upgrade home");
    expect(await readVersion()).toBe(4);
    const help = await sandbox.run(["maintenance", "upgrade", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain(
      "never upgrade Home, archives, or libraries automatically",
    );
    const version = await sandbox.run(["--version"]);
    expect(version.exitCode).toBe(0);
    const manifest = JSON.parse(await readFile(new URL("../../packages/cli/package.json", import.meta.url), "utf8")) as { version: string };
    expect(version.stdout.trim()).toBe(manifest.version);
    expect(await readVersion()).toBe(4);
    const upgraded = await sandbox.run([
      "maintenance",
      "upgrade",
      "home",
      "--json",
    ]);
    expect(upgraded.exitCode, upgraded.stderr).toBe(0);
    expect(await readVersion()).toBe(5);
    const inspect = await sandbox.run([
      sandbox.archiveUri,
      "inspect",
      "--json",
    ]);
    expect(inspect.exitCode, inspect.stderr).toBe(0);
  });

  it("reads the legacy winning ZIP alias through the packed CLI", async () => {
    const sandbox = await createCLISandbox("zip-alias");
    const chapter = await createSourcedArchive(sandbox, {
      source: "Original source.",
      title: "Alias regression",
    });
    const file = new NodeFile(sandbox.archivePath);
    const reader = await nodeWikiGraphPlatform.zip.open(file);
    const entries = [];
    try {
      for (const name of await reader.listEntries()) {
        entries.push({ name, data: (await reader.readEntry(name))! });
      }
    } finally {
      await reader.close();
    }
    const source = entries.find((entry) =>
      /^texts\/source\/\d+\.txt$/u.test(entry.name),
    );
    expect(source).toBeDefined();
    // Preserve sentence offsets: this fixture changes only the ZIP alias.
    const replacement = "Changed content.";
    // Repeat the earlier raw name after the alias: its last contents must not
    // change which distinct normalized name wins.
    await nodeWikiGraphPlatform.zip.write(file, [
      ...entries,
      {
        name: `./${source!.name}`,
        data: new TextEncoder().encode(replacement),
      },
      source!,
    ]);
    const result = await sandbox.run([`${chapter.locatedUri}/source`]);
    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `${replacement}\n`,
    });
  });

  it("installs the consumer project with only wiki-graph as a direct dependency", async () => {
    const { installRoot } = inject("cliE2E");
    const manifest: unknown = JSON.parse(
      await readFile(`${installRoot}/package.json`, "utf8"),
    );
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      !("dependencies" in manifest) ||
      typeof manifest.dependencies !== "object" ||
      manifest.dependencies === null
    ) {
      throw new Error("The temporary CLI install has no dependency map.");
    }

    expect(Object.keys(manifest.dependencies)).toEqual(["wiki-graph"]);
    const cliDependency = (manifest.dependencies as Record<string, unknown>)[
      "wiki-graph"
    ];
    expect(typeof cliDependency).toBe("string");
    expect(cliDependency).toMatch(/wiki-graph-[^/]+\.tgz$/u);
  });

  it("routes root and URI help through the packed executable", async () => {
    const sandbox = await createCLISandbox("help-routes");
    const root = await sandbox.run(["--help"]);
    expect(root.exitCode, root.stderr).toBe(0);
    expect(root.stdout).toContain("Wiki Graph CLI");
    expect(root.stdout).toContain("wg help recipe");

    const uri = await sandbox.run(["wikg://book.wikg", "--help"]);
    expect(uri.exitCode, uri.stderr).toBe(0);
    expect(uri.stdout).toContain("Archive scope");
    expect(uri.stdout).toContain("inspect");
  });

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

    const humanInspect = await sandbox.run([sandbox.archiveUri, "inspect"]);
    expect(humanInspect.exitCode, humanInspect.stderr).toBe(0);
    expect(humanInspect.stdout).toContain("Archive Inspect");
    expect(humanInspect.stdout).toContain("Chapters: 1 content / 1 total");

    const chapters = await sandbox.runJSON<{
      readonly objects: readonly { readonly uri: string }[];
    }>([`${sandbox.archiveUri}/chapter`, "--depth", "0", "--json"]);
    expect(chapters.objects).toHaveLength(1);
    expect(chapters.objects[0]?.uri).toBe(`${chapter.uri}/title`);
  });

  it("reads and mutates the optional archive title object", async () => {
    const sandbox = await createCLISandbox("archive-title");
    await sandbox.runJSON([sandbox.archiveUri, "create", "--json"]);

    const missing = await sandbox.run([`${sandbox.archiveUri}/title`]);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain("is missing");

    const set = await sandbox.run([
      `${sandbox.archiveUri}/title`,
      "set",
      "Archive E2E Title",
    ]);
    expect(set.exitCode, set.stderr).toBe(0);
    const title = await sandbox.runJSON<{
      readonly title: string;
      readonly type: string;
      readonly uri: string;
    }>([`${sandbox.archiveUri}/title`, "--json"]);
    expect(title).toEqual({
      title: "Archive E2E Title",
      type: "archive-title",
      uri: "wikg://title",
    });

    await sandbox.run([`${sandbox.archiveUri}/title`, "clear"]);
    const cleared = await sandbox.run([`${sandbox.archiveUri}/title`]);
    expect(cleared.exitCode).not.toBe(0);
    await sandbox.run([
      `${sandbox.archiveUri}/meta`,
      "put",
      "title",
      "Metadata E2E Title",
    ]);
    await expect(
      sandbox.runJSON<{ readonly title: string }>([
        `${sandbox.archiveUri}/title`,
        "--json",
      ]),
    ).resolves.toMatchObject({ title: "Metadata E2E Title" });

    const listed = await sandbox.runJSON<{
      readonly objects: readonly {
        readonly type: string;
        readonly uri: string;
      }[];
    }>([sandbox.archiveUri, "list", "--json"]);
    expect(listed.objects).toContainEqual(
      expect.objectContaining({ type: "meta", uri: "wikg://meta" }),
    );
    expect(listed.objects.some((item) => item.uri === "wikg://")).toBe(false);

    const unsynced = await sandbox.run([
      sandbox.archiveUri,
      "--query",
      "Metadata E2E Title",
      "--json",
    ]);
    expect(unsynced.exitCode).not.toBe(0);
    expect(unsynced.stdout).toContain("index sync");
    const sync = await sandbox.run([
      `${sandbox.archiveUri}/index`,
      "sync",
      "--jsonl",
    ]);
    expect(sync.exitCode, sync.stdout + sync.stderr).toBe(0);
    const searched = await sandbox.runJSON<{
      readonly objects: readonly {
        readonly type: string;
        readonly uri: string;
      }[];
    }>([sandbox.archiveUri, "--query", "Metadata E2E Title", "--json"]);
    expect(searched.objects).toContainEqual(
      expect.objectContaining({ type: "archive-title", uri: "wikg://title" }),
    );
    expect(searched.objects.some((item) => item.uri === "wikg://")).toBe(false);
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

  it("returns a non-zero status, stderr, and a help route for missing LLM config", async () => {
    const sandbox = await createCLISandbox("missing-config");
    const chapter = await createSourcedArchive(sandbox, {
      source: "Arthur prepared to leave Earth.",
      title: "Unconfigured generation",
    });

    const result = await sandbox.run([
      "wikg://local/job",
      "add",
      "--input",
      chapter.locatedUri,
      "--task",
      "reading-graph",
      "--accept-cost",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Missing LLM configuration");
    expect(result.stderr).toContain("wikg://local/config/llm");

    const invalid = await sandbox.run([sandbox.archiveUri, "unknown"]);
    expect(invalid.exitCode).not.toBe(0);
    expect(invalid.stderr).toContain("--help");
  });
});
