import { readdir, rename } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers/temp.js";
import { startRegressionProcess } from "../helpers/regression-process.js";

describe("Windows SDK end-to-end archive workflow", () => {
  it("builds FTS, appends durable job events, publishes ZIP and queries after process restart", async () => {
    await withTempDir("wg-sdk-e2e-", async (root) => {
      const build = startRegressionProcess("build", root);
      let built: { value: { events: Array<{ type: string; seq: number }> } };
      try {
        built = (await build.message()) as typeof built;
        expect(await build.exit).toBe(0);
        expect(built.value.events.map((event) => event.type)).toEqual(
          expect.arrayContaining([
            "created",
            "paused",
            "resumed",
            "started",
            "succeeded",
          ]),
        );
        const seq = built.value.events.map((event) => event.seq);
        expect(new Set(seq).size).toBe(seq.length);
        expect(seq).toEqual([...seq].sort((a, b) => a - b));
      } finally {
        await build.stop();
      }
      // Verify the published archive is replaceable before the next SDK process opens it.
      const archivePath = join(root, "book.wikg");
      await rename(archivePath, `${archivePath}.closed`);
      await rename(`${archivePath}.closed`, archivePath);
      const reopened = startRegressionProcess("reopen", root);
      try {
        const result = (await reopened.message()) as {
          value: { hits: unknown[]; events: unknown[]; chapters: unknown[] };
        };
        expect(await reopened.exit).toBe(0);
        expect(result.value.hits.length).toBeGreaterThan(0);
        expect(JSON.stringify(result.value.hits).toLowerCase()).toContain(
          "observatory",
        );
        expect(result.value.events).toEqual(built.value.events);
        expect(result.value.chapters).toHaveLength(1);
      } finally {
        await reopened.stop();
      }
      expect((await readdir(root)).sort()).toEqual(["book.wikg", "state"]);
    });
  });
});
