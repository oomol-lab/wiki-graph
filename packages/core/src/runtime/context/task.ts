import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { z } from "zod";

import { createHash } from "../../utils/hash.js";
import { isNodeError } from "../../utils/node-error.js";

export const WIKI_GRAPH_CONTEXT_VERSION = 1;

const TASK_STATUS_VERSION = 1;

const taskStatusSchema = z.object({
  completedAt: z.string().optional(),
  startedAt: z.string(),
  status: z.enum(["running", "succeeded"]),
  version: z.literal(TASK_STATUS_VERSION),
});

export type WikiGraphTaskType = "source-to-graph" | "source-graph-to-summary";

export interface WikiGraphTaskIdentity {
  readonly normalizedSource: string;
  readonly parameters: unknown;
  readonly taskType: WikiGraphTaskType;
  readonly version?: number;
}

export interface WikiGraphTaskContextOptions {
  readonly rootDirPath: string;
}

export interface WikiGraphTaskRun<T> {
  readonly task: WikiGraphTask;
  run(operation: (task: WikiGraphTask) => Promise<T> | T): Promise<T>;
}

interface TaskStatus {
  readonly completedAt?: string | undefined;
  readonly startedAt: string;
  readonly status: "running" | "succeeded";
  readonly version: typeof TASK_STATUS_VERSION;
}

export class WikiGraphTaskContext {
  readonly #rootDirPath: string;

  public constructor(options: WikiGraphTaskContextOptions) {
    this.#rootDirPath = resolve(options.rootDirPath);
  }

  public createTask(identity: WikiGraphTaskIdentity): WikiGraphTask {
    const taskId = createWikiGraphTaskId(identity);

    return new WikiGraphTask(taskId, join(this.#rootDirPath, taskId));
  }

  public async runTask<T>(
    identity: WikiGraphTaskIdentity,
    operation: (task: WikiGraphTask) => Promise<T> | T,
  ): Promise<T> {
    const task = this.createTask(identity);

    return await task.run(operation);
  }
}

export class WikiGraphTask {
  readonly #id: string;
  readonly #path: string;

  public constructor(id: string, path: string) {
    this.#id = id;
    this.#path = resolve(path);
  }

  public get artifactDirPath(): string {
    return join(this.#path, "artifacts");
  }

  public get id(): string {
    return this.#id;
  }

  public get path(): string {
    return this.#path;
  }

  public async readStatus(): Promise<TaskStatus | undefined> {
    try {
      const status = JSON.parse(
        await readFile(this.#getStatusPath(), "utf8"),
      ) as unknown;

      return taskStatusSchema.parse(status);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  public async run<T>(
    operation: (task: WikiGraphTask) => Promise<T> | T,
  ): Promise<T> {
    await this.#begin();

    const result = await operation(this);

    await this.#complete();
    await this.remove();
    return result;
  }

  public async remove(): Promise<void> {
    await rm(this.#path, { force: true, recursive: true });
  }

  async #begin(): Promise<void> {
    await mkdir(this.artifactDirPath, { recursive: true });
    await this.#writeStatus({
      startedAt: new Date().toISOString(),
      status: "running",
      version: TASK_STATUS_VERSION,
    });
  }

  async #complete(): Promise<void> {
    const existingStatus = await this.readStatus();

    await this.#writeStatus({
      completedAt: new Date().toISOString(),
      startedAt: existingStatus?.startedAt ?? new Date().toISOString(),
      status: "succeeded",
      version: TASK_STATUS_VERSION,
    });
  }

  async #writeStatus(status: TaskStatus): Promise<void> {
    await mkdir(this.#path, { recursive: true });
    await writeFile(
      this.#getStatusPath(),
      `${JSON.stringify(status, null, 2)}\n`,
      "utf8",
    );
  }

  #getStatusPath(): string {
    return join(this.#path, "status.json");
  }
}

export function createWikiGraphTaskId(identity: WikiGraphTaskIdentity): string {
  return createHash({
    normalizedSource: identity.normalizedSource,
    parameters: identity.parameters,
    taskType: identity.taskType,
    version: identity.version ?? WIKI_GRAPH_CONTEXT_VERSION,
  });
}
