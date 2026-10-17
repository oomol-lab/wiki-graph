import { z } from "zod";

import {
  ensureRelativeDirectory,
  ensureRelativeFile,
  getRelativeFile,
  readFileText,
  writeFileContent,
  type Directory,
} from "../platform/index.js";
import { createBase32Hash } from "../../utils/hash.js";

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
  readonly root: Directory;
}

export interface WikiGraphTaskRun<T> {
  readonly task: WikiGraphTask;
  run(operation: (task: WikiGraphTask) => Promise<T> | T): Promise<T>;
}

type TaskStatus = z.infer<typeof taskStatusSchema>;

export class WikiGraphTaskContext {
  readonly #root: Directory;

  public constructor(options: WikiGraphTaskContextOptions) {
    this.#root = options.root;
  }

  public createTask(identity: WikiGraphTaskIdentity): WikiGraphTask {
    return new WikiGraphTask(createWikiGraphTaskId(identity), this.#root);
  }

  public async runTask<T>(
    identity: WikiGraphTaskIdentity,
    operation: (task: WikiGraphTask) => Promise<T> | T,
  ): Promise<T> {
    return await this.createTask(identity).run(operation);
  }
}

export class WikiGraphTask {
  readonly #id: string;
  readonly #root: Directory;
  #directory: Directory | undefined;

  public constructor(id: string, root: Directory) {
    this.#id = id;
    this.#root = root;
  }

  public async artifactDirectory(): Promise<Directory> {
    return await ensureRelativeDirectory(
      await this.#getDirectory(),
      "artifacts",
    );
  }

  public get id(): string {
    return this.#id;
  }

  public async readStatus(): Promise<TaskStatus | undefined> {
    const file = await getRelativeFile(this.#root, `${this.#id}/status.json`);
    if (file === undefined) return undefined;
    return taskStatusSchema.parse(JSON.parse(await readFileText(file)));
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
    await this.#root.remove(this.#id, { recursive: true });
    this.#directory = undefined;
  }

  async #begin(): Promise<void> {
    await this.artifactDirectory();
    await this.#writeStatus({
      startedAt: new Date().toISOString(),
      status: "running",
      version: TASK_STATUS_VERSION,
    });
  }

  async #complete(): Promise<void> {
    const existing = await this.readStatus();
    await this.#writeStatus({
      completedAt: new Date().toISOString(),
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      status: "succeeded",
      version: TASK_STATUS_VERSION,
    });
  }

  async #writeStatus(status: TaskStatus): Promise<void> {
    const file = await ensureRelativeFile(
      await this.#getDirectory(),
      "status.json",
    );
    await writeFileContent(file, `${JSON.stringify(status, null, 2)}\n`);
  }

  async #getDirectory(): Promise<Directory> {
    this.#directory ??=
      (await this.#root.getDirectory(this.#id)) ??
      (await this.#root.createDirectory(this.#id));
    return this.#directory;
  }
}

export function createWikiGraphTaskId(identity: WikiGraphTaskIdentity): string {
  return createBase32Hash({
    normalizedSource: identity.normalizedSource,
    parameters: identity.parameters,
    taskType: identity.taskType,
    version: identity.version ?? WIKI_GRAPH_CONTEXT_VERSION,
  });
}
