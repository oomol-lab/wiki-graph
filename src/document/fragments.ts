import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { join, resolve } from "path";

import { isNodeError } from "../utils/node-error.js";
import type { FragmentRecord, SentenceId, SentenceRecord } from "./types.js";

const SERIAL_DIRECTORY_PREFIX = "serial-";
const FRAGMENT_FILE_PATTERN = /^fragment_(\d+)\.json$/;
const DEFAULT_FRAGMENT_WORDS_COUNT = 600;

interface FragmentFileContent {
  readonly summary: string;
  readonly sentences: readonly SentenceRecord[];
}

interface FragmentWriter {
  write(path: string, content: string): Promise<void>;
}

interface FragmentFileAccess {
  ensureDirectory(path: string): Promise<void>;
  listFileContents?(path: string): Promise<ReadonlyMap<string, Uint8Array>>;
  listFiles(path: string): Promise<readonly string[]>;
  readFile(path: string): Promise<Uint8Array | undefined>;
}

const DEFAULT_FRAGMENT_WRITER: FragmentWriter = {
  write: async (path, content) => {
    await writeFile(path, content, "utf8");
  },
};

const DEFAULT_FRAGMENT_FILE_ACCESS: FragmentFileAccess = {
  ensureDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  listFiles: async (path) =>
    (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  readFile: async (path) => {
    try {
      return await readFile(path);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  },
};

export interface ReadonlyFragments {
  getSerial(serialId: number): ReadonlySerialFragments;
  getSummarySerial(serialId: number): ReadonlySerialFragments;
  getSentence(sentenceId: SentenceId): Promise<string>;
  getSummary(serialId: number, fragmentId: number): Promise<string>;
  getWordsCount(serialId: number, fragmentId: number): Promise<number>;
  readonly path: string;
}

export interface TextStreamWriteOptions {
  readonly maxWordsCount?: number;
}

export interface ReadonlySerialFragments {
  getFragment(fragmentId: number): Promise<FragmentRecord>;
  listFragmentIds(): Promise<readonly number[]>;
  readonly serialId: number;
  readonly path: string;
}

export class Fragments implements ReadonlyFragments {
  readonly #documentPath: string;
  readonly #fileAccess: FragmentFileAccess;
  readonly #writer: FragmentWriter;

  public constructor(
    documentPath: string,
    writer?: FragmentWriter,
    fileAccess?: FragmentFileAccess,
  ) {
    this.#documentPath = resolve(documentPath);
    this.#fileAccess = fileAccess ?? DEFAULT_FRAGMENT_FILE_ACCESS;
    this.#writer = writer ?? DEFAULT_FRAGMENT_WRITER;
  }

  public async ensureCreated(): Promise<void> {
    await this.#fileAccess.ensureDirectory(this.path);
  }

  public getSerial(serialId: number): SerialFragments {
    return new SerialFragments(
      this.#documentPath,
      serialId,
      "fragments",
      this.#writer,
      this.#fileAccess,
    );
  }

  public getSummarySerial(serialId: number): SerialFragments {
    return new SerialFragments(
      this.#documentPath,
      serialId,
      "summaries",
      this.#writer,
      this.#fileAccess,
    );
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    const [serialId, sentenceIndex] = sentenceId;
    const fragmentIds = await this.getSerial(serialId).listFragmentIds();
    let remainingSentenceIndex = sentenceIndex;

    for (const fragmentId of fragmentIds) {
      const fragment = await this.getSerial(serialId).getFragment(fragmentId);
      const sentence = fragment.sentences[remainingSentenceIndex];

      if (sentence !== undefined) {
        return sentence.text;
      }

      remainingSentenceIndex -= fragment.sentences.length;
    }

    throw new RangeError(`Sentence ${sentenceIndex} does not exist`);
  }

  public async getSummary(
    serialId: number,
    fragmentId: number,
  ): Promise<string> {
    return (await this.getSerial(serialId).getFragment(fragmentId)).summary;
  }

  public async getWordsCount(
    serialId: number,
    fragmentId: number,
  ): Promise<number> {
    const fragment = await this.getSerial(serialId).getFragment(fragmentId);

    return fragment.sentences.reduce(
      (total, sentence) => total + sentence.wordsCount,
      0,
    );
  }

  public get path(): string {
    return join(this.#documentPath, "fragments");
  }
}

export class SerialFragments implements ReadonlySerialFragments {
  readonly #serialId: number;
  #draftOpen = false;
  readonly #documentPath: string;
  readonly #fileAccess: FragmentFileAccess;
  #fileContents: Promise<ReadonlyMap<string, Uint8Array>> | undefined;
  readonly #rootDirectoryName: string;
  #nextFragmentId: number | undefined;
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

    return new FragmentDraft(this.#serialId, await this.#peekNextFragmentId(), {
      discard: () => {
        this.#discardDraft();
      },
      finalize: async (fragmentId, summary, sentences) =>
        await this.#commitDraft(fragmentId, summary, sentences),
    });
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

function splitTextIntoSentences(text: string): readonly SentenceRecord[] {
  return text
    .split(/\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "")
    .map((sentence) => ({
      text: sentence,
      wordsCount: countWords(sentence),
    }));
}

function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

export class FragmentDraft {
  #committed = false;
  readonly #serialId: number;
  readonly #discard: () => void;
  readonly #finalize: (
    fragmentId: number,
    summary: string,
    sentences: readonly SentenceRecord[],
  ) => Promise<FragmentRecord | undefined>;
  readonly #fragmentId: number;
  readonly #sentences: SentenceRecord[] = [];
  #summary = "";

  public constructor(
    serialId: number,
    fragmentId: number,
    callbacks: {
      readonly discard: () => void;
      readonly finalize: (
        fragmentId: number,
        summary: string,
        sentences: readonly SentenceRecord[],
      ) => Promise<FragmentRecord | undefined>;
    },
  ) {
    this.#serialId = serialId;
    this.#discard = callbacks.discard;
    this.#finalize = callbacks.finalize;
    this.#fragmentId = fragmentId;
  }

  public addSentence(text: string, wordsCount: number): SentenceId {
    this.#assertActive();
    const sentenceIndex = this.#sentences.length;

    this.#sentences.push({
      text,
      wordsCount,
    });

    return [this.#serialId, sentenceIndex];
  }

  public async commit(): Promise<FragmentRecord | undefined> {
    this.#assertActive();
    this.#committed = true;

    return await this.#finalize(
      this.#fragmentId,
      this.#summary,
      this.#sentences,
    );
  }

  public discard(): void {
    this.#assertActive();
    this.#committed = true;
    this.#discard();
  }

  public setSummary(summary: string): void {
    this.#assertActive();
    this.#summary = summary;
  }

  public get fragmentId(): number {
    return this.#fragmentId;
  }

  #assertActive(): void {
    if (this.#committed) {
      throw new Error("Fragment draft is already finalized");
    }
  }
}

async function readFragmentFile(
  fragmentPath: string,
  fileAccess: FragmentFileAccess = DEFAULT_FRAGMENT_FILE_ACCESS,
): Promise<FragmentFileContent> {
  return parseFragmentFileContent(
    fragmentPath,
    await readFragmentFileContent(fragmentPath, fileAccess),
  );
}

function parseFragmentFileContent(
  fragmentPath: string,
  content: Uint8Array | undefined,
): FragmentFileContent {
  if (content === undefined) {
    throw new Error(`Fragment file does not exist: ${fragmentPath}`);
  }

  const rawContent = JSON.parse(
    Buffer.from(content).toString("utf8"),
  ) as unknown;

  if (typeof rawContent !== "object" || rawContent === null) {
    throw new TypeError("Fragment file must be an object");
  }

  if (!("summary" in rawContent) || typeof rawContent.summary !== "string") {
    throw new TypeError("Fragment file summary must be a string");
  }
  if (!("sentences" in rawContent) || !Array.isArray(rawContent.sentences)) {
    throw new TypeError("Fragment file sentences must be an array");
  }

  return {
    sentences: rawContent.sentences.map(parseSentenceRecord),
    summary: rawContent.summary,
  };
}

async function readFragmentFileContent(
  fragmentPath: string,
  fileAccess: FragmentFileAccess,
): Promise<Uint8Array | undefined> {
  if (fileAccess.listFileContents === undefined) {
    return await fileAccess.readFile(fragmentPath);
  }

  const directoryPath = resolve(join(fragmentPath, ".."));
  const fileName = fragmentPath.slice(directoryPath.length + 1);

  return (await fileAccess.listFileContents(directoryPath)).get(fileName);
}

function parseSentenceRecord(value: unknown): SentenceRecord {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Sentence entry must be an object");
  }

  const { text, wordsCount } = value as {
    readonly text?: unknown;
    readonly wordsCount?: unknown;
  };

  if (typeof text !== "string" || typeof wordsCount !== "number") {
    throw new TypeError("Sentence entry is invalid");
  }

  return {
    text,
    wordsCount,
  };
}
