import { join, resolve } from "path";

import type { Database } from "../database.js";
import type { SentenceId } from "../types.js";
import { DEFAULT_FILE_ACCESS } from "./file-access.js";
import { SerialTextStream } from "./serial.js";
import type {
  ReadonlyTextStreams,
  TextStreamFileAccess,
  TextStreamName,
} from "./types.js";

export class TextStreams implements ReadonlyTextStreams {
  readonly #database: Database;
  readonly #documentPath: string;
  readonly #fileAccess: TextStreamFileAccess;

  public constructor(
    documentPath: string,
    database: Database,
    fileAccess: TextStreamFileAccess = DEFAULT_FILE_ACCESS,
  ) {
    this.#database = database;
    this.#documentPath = resolve(documentPath);
    this.#fileAccess = fileAccess;
  }

  public async ensureCreated(): Promise<void> {
    await this.#fileAccess.ensureDirectory(this.#getRootPath("source"));
    await this.#fileAccess.ensureDirectory(this.#getRootPath("summary"));
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    return (await this.getSerial(sentenceId[0]).getSentence(sentenceId[1]))
      .text;
  }

  public getSerial(serialId: number): SerialTextStream {
    return new SerialTextStream(
      this.#documentPath,
      this.#database,
      this.#fileAccess,
      "source",
      serialId,
    );
  }

  public getSummarySerial(serialId: number): SerialTextStream {
    return new SerialTextStream(
      this.#documentPath,
      this.#database,
      this.#fileAccess,
      "summary",
      serialId,
    );
  }

  #getRootPath(stream: TextStreamName): string {
    return join(this.#documentPath, "texts", stream);
  }
}
