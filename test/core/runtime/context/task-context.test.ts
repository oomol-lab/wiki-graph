import { access, readFile, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  createWikiGraphTaskId,
  WikiGraphTaskContext,
} from "../../../../packages/core/src/runtime/context/index.js";
import { withTempDir } from "../../../helpers/temp.js";
import {
  getNodeResourcePath,
  NodeDirectory,
} from "../../../../packages/cli/src/runtime/node-platform.js";

describe("context/task-context", () => {
  it("derives task ids from source, parameters, task type, and context version", () => {
    const base = createWikiGraphTaskId({
      normalizedSource: "Alpha beta.",
      parameters: {
        sampling: {
          temperature: 0.2,
        },
      },
      taskType: "source-to-graph",
    });

    expect(base).toHaveLength(52);
    expect(base).toMatch(/^[A-Z2-7]+$/u);
    expect(
      createWikiGraphTaskId({
        normalizedSource: "Alpha beta.",
        parameters: {
          sampling: {
            temperature: 0.2,
          },
        },
        taskType: "source-to-graph",
      }),
    ).toBe(base);
    expect(
      createWikiGraphTaskId({
        normalizedSource: "Alpha beta.",
        parameters: {
          sampling: {
            temperature: 0.2,
          },
        },
        taskType: "source-graph-to-summary",
      }),
    ).not.toBe(base);
    expect(
      createWikiGraphTaskId({
        normalizedSource: "Alpha beta.",
        parameters: {
          sampling: {
            temperature: 0.2,
          },
        },
        taskType: "source-to-graph",
        version: 2,
      }),
    ).not.toBe(base);
  });

  it("removes a task directory after a successful run", async () => {
    await withTempDir("wikigraph-context-", async (path) => {
      const context = new WikiGraphTaskContext({
        root: new NodeDirectory(path),
      });
      let taskPath = "";

      const value = await context.runTask(
        {
          normalizedSource: "Alpha beta.",
          parameters: {
            sampling: {},
          },
          taskType: "source-to-graph",
        },
        async (task) => {
          taskPath = `${path}/${task.id}`;
          await writeFile(
            `${getNodeResourcePath(await task.artifactDirectory())}/artifact.txt`,
            "done",
          );
          return 42;
        },
      );

      expect(value).toBe(42);
      await expect(access(taskPath)).rejects.toThrow();
    });
  });

  it("keeps a task directory when a run fails", async () => {
    await withTempDir("wikigraph-context-", async (path) => {
      const context = new WikiGraphTaskContext({
        root: new NodeDirectory(path),
      });
      let taskPath = "";

      await expect(
        context.runTask(
          {
            normalizedSource: "Alpha beta.",
            parameters: {},
            taskType: "source-to-graph",
          },
          async (task) => {
            taskPath = `${path}/${task.id}`;
            await writeFile(
              `${getNodeResourcePath(await task.artifactDirectory())}/artifact.txt`,
              "partial",
            );
            throw new Error("stop");
          },
        ),
      ).rejects.toThrow("stop");

      await expect(access(taskPath)).resolves.toBe(undefined);
      await expect(
        readFile(`${taskPath}/artifacts/artifact.txt`, "utf8"),
      ).resolves.toBe("partial");
      await expect(
        readFile(`${taskPath}/status.json`, "utf8"),
      ).resolves.toContain('"status": "running"');
    });
  });

  it("reuses the same task directory for the same identity after failure", async () => {
    await withTempDir("wikigraph-context-", async (path) => {
      const context = new WikiGraphTaskContext({
        root: new NodeDirectory(path),
      });
      const identity = {
        normalizedSource: "Alpha beta.",
        parameters: {
          sampling: {
            temperature: 0.2,
          },
        },
        taskType: "source-to-graph" as const,
      };
      let failedTaskPath = "";

      await expect(
        context.runTask(identity, async (task) => {
          failedTaskPath = `${path}/${task.id}`;
          await writeFile(
            `${getNodeResourcePath(await task.artifactDirectory())}/artifact.txt`,
            "partial",
          );
          throw new Error("stop");
        }),
      ).rejects.toThrow("stop");

      const result = await context.runTask(identity, async (task) => {
        expect(`${path}/${task.id}`).toBe(failedTaskPath);
        const artifactDirPath = getNodeResourcePath(
          await task.artifactDirectory(),
        );
        await expect(
          readFile(`${artifactDirPath}/artifact.txt`, "utf8"),
        ).resolves.toBe("partial");
        await writeFile(`${artifactDirPath}/artifact.txt`, "complete");
        return "ok";
      });

      expect(result).toBe("ok");
      await expect(access(failedTaskPath)).rejects.toThrow();
    });
  });

  it("reads a running task status", async () => {
    await withTempDir("wikigraph-context-", async (path) => {
      const context = new WikiGraphTaskContext({
        root: new NodeDirectory(path),
      });
      let status:
        | Awaited<
            ReturnType<ReturnType<typeof context.createTask>["readStatus"]>
          >
        | undefined;

      await expect(
        context.runTask(
          {
            normalizedSource: "Alpha beta.",
            parameters: {},
            taskType: "source-graph-to-summary",
          },
          async (task) => {
            status = await task.readStatus();
            throw new Error("stop");
          },
        ),
      ).rejects.toThrow("stop");

      expect(status).toMatchObject({
        status: "running",
        version: 1,
      });
      expect(status?.startedAt).toEqual(expect.any(String));
    });
  });
});
