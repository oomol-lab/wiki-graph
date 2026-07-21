import { join } from "path";
import { stat } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  WikiGraph,
  WikiGraphArchive,
  WikiGraphArchiveFile,
  WikiGraphScope,
} from "wiki-graph-core";
import { tryRunWikiGraphGc } from "wiki-graph-core/gc";
import { runBuildJobWorker } from "wiki-graph-core/worker";
import { withTempDir } from "../../../helpers/temp.js";

describe("wiki-graph-core sdk", () => {
  it("exports the main SDK surface without CLI entrypoints", () => {
    expect(typeof WikiGraph).toBe("function");
    expect(typeof WikiGraphArchive).toBe("function");
    expect(typeof WikiGraphArchiveFile).toBe("function");
    expect(WikiGraphScope.ReaderExtraction).toBe(
      "serial-generation/reader-extraction",
    );
  });

  it("exports process-local worker and gc SDK entrypoints", () => {
    expect(typeof runBuildJobWorker).toBe("function");
    expect(typeof tryRunWikiGraphGc).toBe("function");
  });

  it("can create and reopen an archive from the SDK", async () => {
    await withTempDir("wikigraph-sdk-", async (path) => {
      const archivePath = join(path, "note.wikg");
      const app = new WikiGraph({});

      await app.digestTextStreamSession(
        {
          stream: ["Alpha is connected to beta.\n"],
          targetStage: "planned",
          title: "SDK note",
        },
        async (archive) => {
          await archive.saveAs(archivePath);
        },
      );

      await app.openSession(archivePath, async (archive) => {
        expect((await archive.readMeta())?.title).toBe("SDK note");
      });
      expect((await stat(archivePath)).isFile()).toBe(true);
    });
  });
});
