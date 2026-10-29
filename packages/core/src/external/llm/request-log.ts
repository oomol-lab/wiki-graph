import {
  appendFileText,
  type Directory,
  type File,
} from "../../runtime/platform/index.js";

let requestLogSequence = 0;

export class RequestLog {
  readonly #filePromise: Promise<File> | undefined;

  public constructor(filePromise?: Promise<File>) {
    this.#filePromise = filePromise;
    void filePromise?.catch(() => {});
  }

  public get filePath(): undefined {
    return undefined;
  }

  public async append(content: string): Promise<void> {
    if (this.#filePromise !== undefined) {
      try {
        await appendFileText(await this.#filePromise, content);
      } catch {
        /* Logging is best effort. */
      }
    }
  }
}

export function createRequestLog(directory?: Directory): RequestLog {
  if (directory === undefined) return new RequestLog();
  requestLogSequence += 1;
  const name = `request-${requestLogSequence}.log`;
  return new RequestLog(
    directory
      .getFile(name)
      .then(async (file) => file ?? directory.createFile(name)),
  );
}
