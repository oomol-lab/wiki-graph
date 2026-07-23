import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addWikiGraphLibraryArchive,
  parseWikiGraphLibraryUri,
} from "wiki-graph-core";
import {
  getWikiGraphStateDirectoryPathForTesting,
  setWikiGraphStateDirectoryPathForTesting,
} from "../../../../../core/src/runtime/common/wiki-graph/dir.js";
import { resolveArchiveCommandRuntimeArguments } from "./uri.js";

let previousStateDir: string | undefined;
let tempDir: string;

beforeEach(async () => {
  previousStateDir = getWikiGraphStateDirectoryPathForTesting();
  tempDir = await mkdtemp(join(tmpdir(), "wikigraph-cli-uri-test-"));
  setWikiGraphStateDirectoryPathForTesting(join(tempDir, "state"));
});

afterEach(async () => {
  setWikiGraphStateDirectoryPathForTesting(previousStateDir);
  await rm(tempDir, { force: true, recursive: true });
});

describe("archive-command URI runtime resolution", () => {
  it("resolves library archive object URIs before running archive commands", async () => {
    const target = parseWikiGraphLibraryUri("wikg://lib");
    expect(target).toBeDefined();
    const source = join(tempDir, "book.wikg");
    await writeFile(source, "content");
    const archive = await addWikiGraphLibraryArchive({
      inputPath: source,
      target: target!,
      to: "books/book.wikg",
    });

    await expect(
      resolveArchiveCommandRuntimeArguments({
        action: "get",
        archivePath: `${archive.uri}/entity/Q23`,
        format: "json",
        objectId: `${archive.uri}/entity/Q23`,
      }),
    ).resolves.toStrictEqual({
      action: "get",
      archivePath: `wikg://${archive.path}/entity/Q23`,
      format: "json",
      objectId: `wikg://${archive.path}/entity/Q23`,
    });
  });
});
