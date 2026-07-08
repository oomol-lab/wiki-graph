import { appendFile } from "fs/promises";
import { allocateArtifactPath } from "../common/logging.js";

export class RequestLog {
  readonly #filePath: string | undefined;

  public constructor(filePath?: string) {
    this.#filePath = filePath;
  }

  public get filePath(): string | undefined {
    return this.#filePath;
  }

  public async append(content: string): Promise<void> {
    if (this.#filePath === undefined) {
      return;
    }
    await appendFile(this.#filePath, content, "utf8");
  }
}

export function createRequestLog(logDirPath?: string): RequestLog {
  if (logDirPath === undefined) {
    return new RequestLog();
  }

  return new RequestLog(
    allocateArtifactPath({
      alwaysNumbered: true,
      category: "llm",
      logDirPath,
      prefix: "request",
    }),
  );
}
