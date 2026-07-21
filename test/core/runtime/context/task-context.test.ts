import { access, readFile, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  createWikiGraphTaskId,
  WikiGraphTaskContext,
} from "../../../../packages/core/src/runtime/context/index.js";
import { withTempDir } from "../../../helpers/temp.js";

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

    expect(base).toHaveLength(128);
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
        rootDirPath: path,
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
          taskPath = task.path;
          await writeFile(`${task.artifactDirPath}/artifact.txt`, "done");
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
        rootDirPath: path,
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
            taskPath = task.path;
            await writeFile(`${task.artifactDirPath}/artifact.txt`, "partial");
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
        rootDirPath: path,
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
          failedTaskPath = task.path;
          await writeFile(`${task.artifactDirPath}/artifact.txt`, "partial");
          throw new Error("stop");
        }),
      ).rejects.toThrow("stop");

      const result = await context.runTask(identity, async (task) => {
        expect(task.path).toBe(failedTaskPath);
        await expect(
          readFile(`${task.artifactDirPath}/artifact.txt`, "utf8"),
        ).resolves.toBe("partial");
        await writeFile(`${task.artifactDirPath}/artifact.txt`, "complete");
        return "ok";
      });

      expect(result).toBe("ok");
      await expect(access(failedTaskPath)).rejects.toThrow();
    });
  });

  it("reads a running task status", async () => {
    await withTempDir("wikigraph-context-", async (path) => {
      const context = new WikiGraphTaskContext({
        rootDirPath: path,
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
