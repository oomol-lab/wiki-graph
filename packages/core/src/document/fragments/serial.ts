import { join, resolve } from "path";

import { isNodeError } from "../../utils/node-error.js";
import type { FragmentRecord, SentenceRecord } from "../types.js";
import { FragmentDraft } from "./draft.js";
import {
  DEFAULT_FRAGMENT_FILE_ACCESS,
  DEFAULT_FRAGMENT_WRITER,
} from "./file-access.js";
import { parseFragmentFileContent, readFragmentFile } from "./file.js";
import { splitTextIntoSentences } from "./sentence.js";
import {
  DEFAULT_FRAGMENT_WORDS_COUNT,
  FRAGMENT_FILE_PATTERN,
  SERIAL_DIRECTORY_PREFIX,
  type FragmentFileAccess,
  type FragmentWriter,
  type ReadonlySerialFragments,
  type TextStreamWriteOptions,
} from "./types.js";

export class SerialFragments implements ReadonlySerialFragments {
  readonly #serialId: number;
  #draftOpen = false;
  readonly #documentPath: string;
  readonly #fileAccess: FragmentFileAccess;
  #fileContents: Promise<ReadonlyMap<string, Uint8Array>> | undefined;
  readonly #rootDirectoryName: string;
  #nextFragmentId: number | undefined;
  #nextSentenceIndex: number | undefined;
  readonly #writer: FragmentWriter;

  public constructor(
    documentPath: string,
    serialId: number,
    rootDirectoryName = "fragments",
    writer?: FragmentWriter,
    fileAccess?: FragmentFileAccess,
  ) {
    this.#documentPath = resolve(documentPath);
    this.#serialId = serialId;
    this.#fileAccess = fileAccess ?? DEFAULT_FRAGMENT_FILE_ACCESS;
    this.#rootDirectoryName = rootDirectoryName;
    this.#writer = writer ?? DEFAULT_FRAGMENT_WRITER;
  }

  public async createDraft(): Promise<FragmentDraft> {
    if (this.#draftOpen) {
      throw new Error("Only one fragment draft can be open at a time");
    }

    await this.#fileAccess.ensureDirectory(this.path);
    this.#draftOpen = true;

    return new FragmentDraft(
      this.#serialId,
      await this.#peekNextFragmentId(),
      await this.#peekNextSentenceIndex(),
      {
        discard: () => {
          this.#discardDraft();
        },
        finalize: async (fragmentId, startSentenceIndex, summary, sentences) =>
          await this.#commitDraft(
            fragmentId,
            startSentenceIndex,
            summary,
            sentences,
          ),
      },
    );
  }

  public async getFragment(fragmentId: number): Promise<FragmentRecord> {
    const fileContent =
      this.#fileAccess.listFileContents === undefined
        ? await readFragmentFile(
            this.#getFragmentPath(fragmentId),
            this.#fileAccess,
          )
        : parseFragmentFileContent(
            this.#getFragmentPath(fragmentId),
            (await this.#getFileContents()).get(`fragment_${fragmentId}.json`),
          );

    return {
      serialId: this.#serialId,
      fragmentId,
      summary: fileContent.summary,
      sentences: fileContent.sentences,
    };
  }

  public async listFragmentIds(): Promise<readonly number[]> {
    try {
      const entries =
        this.#fileAccess.listFileContents === undefined
          ? await this.#fileAccess.listFiles(this.path)
          : [...(await this.#getFileContents()).keys()];

      return entries
        .map((entry) => FRAGMENT_FILE_PATTERN.exec(entry))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number(match[1]))
        .sort((left, right) => left - right);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  public async writeTextStream(
    text: string,
    options: TextStreamWriteOptions = {},
  ): Promise<void> {
    await this.#fileAccess.ensureDirectory(this.path);
    const sentences = splitTextIntoSentences(text);

    if (sentences.length === 0) {
      const fragmentId = await this.#peekNextFragmentId();

      await this.#writer.write(
        this.#getFragmentPath(fragmentId),
        JSON.stringify(
          {
            sentences: [],
            summary: "",
          },
          undefined,
          2,
        ),
      );
      this.#nextFragmentId = fragmentId + 1;
      return;
    }

    const maxWordsCount = options.maxWordsCount ?? DEFAULT_FRAGMENT_WORDS_COUNT;
    let draft = await this.createDraft();
    let draftWordsCount = 0;

    for (const sentence of sentences) {
      if (
        draftWordsCount > 0 &&
        draftWordsCount + sentence.wordsCount > maxWordsCount
      ) {
        await draft.commit();
        draft = await this.createDraft();
        draftWordsCount = 0;
      }

      draft.addSentence(sentence.text, sentence.wordsCount);
      draftWordsCount += sentence.wordsCount;
    }

    await draft.commit();
  }

  public get serialId(): number {
    return this.#serialId;
  }

  public get path(): string {
    return join(
      this.#documentPath,
      this.#rootDirectoryName,
      `${SERIAL_DIRECTORY_PREFIX}${this.#serialId}`,
    );
  }

  async #commitDraft(
    fragmentId: number,
    startSentenceIndex: number,
    summary: string,
    sentences: readonly SentenceRecord[],
  ): Promise<FragmentRecord | undefined> {
    this.#draftOpen = false;

    if (sentences.length === 0) {
      return undefined;
    }

    await this.#fileAccess.ensureDirectory(this.path);
    await this.#writer.write(
      this.#getFragmentPath(fragmentId),
      JSON.stringify(
        {
          sentences,
          summary,
        },
        undefined,
        2,
      ),
    );

    this.#nextFragmentId = fragmentId + 1;
    this.#nextSentenceIndex = startSentenceIndex + sentences.length;

    return {
      serialId: this.#serialId,
      fragmentId,
      summary,
      sentences,
    };
  }

  #discardDraft(): void {
    this.#draftOpen = false;
  }

  async #peekNextFragmentId(): Promise<number> {
    if (this.#nextFragmentId !== undefined) {
      return this.#nextFragmentId;
    }

    const fragmentIds = await this.listFragmentIds();
    const lastFragmentId = fragmentIds[fragmentIds.length - 1];

    this.#nextFragmentId =
      lastFragmentId === undefined ? 0 : lastFragmentId + 1;

    return this.#nextFragmentId;
  }

  async #peekNextSentenceIndex(): Promise<number> {
    if (this.#nextSentenceIndex !== undefined) {
      return this.#nextSentenceIndex;
    }

    let nextSentenceIndex = 0;

    for (const fragmentId of await this.listFragmentIds()) {
      nextSentenceIndex += (await this.getFragment(fragmentId)).sentences
        .length;
    }

    this.#nextSentenceIndex = nextSentenceIndex;
    return this.#nextSentenceIndex;
  }

  #getFragmentPath(fragmentId: number): string {
    return join(this.path, `fragment_${fragmentId}.json`);
  }

  async #getFileContents(): Promise<ReadonlyMap<string, Uint8Array>> {
    if (this.#fileAccess.listFileContents === undefined) {
      throw new Error("Fragment file access does not support batch reads.");
    }

    this.#fileContents ??= this.#fileAccess.listFileContents(this.path);
    return await this.#fileContents;
  }
}
