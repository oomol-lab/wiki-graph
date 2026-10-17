import { describe, expect, it } from "vitest";

import {
  installWikiGraphPlatform,
  readFileText,
  withWikiGraphStorage,
} from "../../../../packages/core/src/runtime/platform/index.js";
import { createWorkspaceSnapshot } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/workspace.js";
import {
  createNodeWikiGraphStorage,
  nodeWikiGraphPlatform,
} from "../../../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("WIKG workspace snapshots", () => {
  it("uses one composite hash directory and compact safe random names", async () => {
    await withTempDir("wikigraph-workspace-layout-", async (root) => {
      installWikiGraphPlatform(nodeWikiGraphPlatform);
      await withWikiGraphStorage(createNodeWikiGraphStorage(root), async () => {
        const first = await createWorkspaceSnapshot(
          "a".repeat(64),
          "chapters/1/source.jsonl",
        );
        const second = await createWorkspaceSnapshot(
          "a".repeat(64),
          "chapters/1/source.jsonl",
        );

        expect(first.relativePath).toMatch(
          /^\.wikg-work\/[0-9a-f]{64}\/[A-Z2-7]{26}\.snapshot$/u,
        );
        expect(second.relativePath).toMatch(
          /^\.wikg-work\/[0-9a-f]{64}\/[A-Z2-7]{26}\.snapshot$/u,
        );
        expect(second.relativePath).not.toBe(first.relativePath);

        const writer = await first.file.openWriter();
        await writer.write("snapshot");
        await writer.commit();
        await expect(readFileText(first.file)).resolves.toBe("snapshot");
      });
    });
  });
});
