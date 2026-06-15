import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { z } from "zod";

import { createHash } from "../utils/hash.js";
import { isNodeError } from "../utils/node-error.js";

export const SPINE_DIGEST_CONTEXT_VERSION = 1;

const TASK_STATUS_VERSION = 1;

const taskStatusSchema = z.object({
  completedAt: z.string().optional(),
  startedAt: z.string(),
  status: z.enum(["running", "succeeded"]),
  version: z.literal(TASK_STATUS_VERSION),
});

export type SpineDigestTaskType = "source-to-graph" | "source-graph-to-summary";

export interface SpineDigestTaskIdentity {
  readonly normalizedSource: string;
  readonly parameters: unknown;
  readonly taskType: SpineDigestTaskType;
  readonly version?: number;
}

export interface SpineDigestTaskContextOptions {
  readonly rootDirPath: string;
}

export interface SpineDigestTaskRun<T> {
  readonly task: SpineDigestTask;
  run(operation: (task: SpineDigestTask) => Promise<T> | T): Promise<T>;
}

interface TaskStatus {
  readonly completedAt?: string | undefined;
  readonly startedAt: string;
  readonly status: "running" | "succeeded";
  readonly version: typeof TASK_STATUS_VERSION;
}

export class SpineDigestTaskContext {
  readonly #rootDirPath: string;

  public constructor(options: SpineDigestTaskContextOptions) {
    this.#rootDirPath = resolve(options.rootDirPath);
  }

  public createTask(identity: SpineDigestTaskIdentity): SpineDigestTask {
    const taskId = createSpineDigestTaskId(identity);

    return new SpineDigestTask(taskId, join(this.#rootDirPath, taskId));
  }

  public async runTask<T>(
    identity: SpineDigestTaskIdentity,
    operation: (task: SpineDigestTask) => Promise<T> | T,
  ): Promise<T> {
    const task = this.createTask(identity);

    return await task.run(operation);
  }
}

export class SpineDigestTask {
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
    operation: (task: SpineDigestTask) => Promise<T> | T,
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

export function createSpineDigestTaskId(
  identity: SpineDigestTaskIdentity,
): string {
  return createHash({
    normalizedSource: identity.normalizedSource,
    parameters: identity.parameters,
    taskType: identity.taskType,
    version: identity.version ?? SPINE_DIGEST_CONTEXT_VERSION,
  });
}
