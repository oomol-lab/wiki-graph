import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";

import { isNodeError } from "../utils/node-error.js";
import type { Database } from "./database.js";
import type { FragmentRecord, SentenceId, SentenceRecord } from "./types.js";

const DEFAULT_FRAGMENT_WORDS_COUNT = 600;
const TEXT_STREAM_KIND = {
  source: 1,
  summary: 2,
} as const;

type TextStreamName = keyof typeof TEXT_STREAM_KIND;

interface TextSentenceLocation {
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly sentenceIndex: number;
  readonly wordsCount: number;
}

interface TextStreamDraftState {
  draftOpen: boolean;
  nextSentenceIndex?: number;
}

interface TextStreamFileAccess {
  deleteTree(path: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
  listFiles(path: string): Promise<readonly string[]>;
  readFile(path: string): Promise<Uint8Array | undefined>;
  writeFile(
    path: string,
    content: string | Uint8Array,
    options: { readonly overwrite?: boolean },
  ): Promise<void>;
}

const DEFAULT_FILE_ACCESS: TextStreamFileAccess = {
  deleteTree: async (path) => {
    await rm(path, { force: true, recursive: true });
  },
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
  writeFile: async (path, content, options) => {
    await writeFile(path, content, {
      ...(typeof content === "string" ? { encoding: "utf8" as const } : {}),
      flag: options.overwrite === true ? "w" : "wx",
    });
  },
};

export interface ReadonlyTextStreams {
  getSentence(sentenceId: SentenceId): Promise<string>;
  getSerial(serialId: number): ReadonlySerialTextStream;
  getSummarySerial(serialId: number): ReadonlySerialTextStream;
}

export interface ReadonlySerialTextStream {
  getFragment(fragmentId: number): Promise<FragmentRecord>;
  getSentence?(sentenceIndex: number): Promise<SentenceRecord>;
  listSentencesInRange?(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<readonly SentenceRecord[]>;
  listFragmentIds(): Promise<readonly number[]>;
  listSentences?(): Promise<readonly SentenceRecord[]>;
  readText?(): Promise<string | undefined>;
  readonly path: string;
  readonly serialId: number;
}

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

export class SerialTextStream implements ReadonlySerialTextStream {
  static readonly #draftStates = new Map<string, TextStreamDraftState>();

  readonly #database: Database;
  readonly #documentPath: string;
  readonly #fileAccess: TextStreamFileAccess;
  readonly #stream: TextStreamName;
  readonly #serialId: number;

  public constructor(
    documentPath: string,
    database: Database,
    fileAccess: TextStreamFileAccess,
    stream: TextStreamName,
    serialId: number,
  ) {
    this.#database = database;
    this.#documentPath = resolve(documentPath);
    this.#fileAccess = fileAccess;
    this.#stream = stream;
    this.#serialId = serialId;
  }

  public async createDraft(): Promise<TextStreamDraft> {
    const draftState = this.#getDraftState();

    if (draftState.draftOpen) {
      throw new Error("Only one text stream draft can be open at a time");
    }

    await this.#fileAccess.ensureDirectory(this.#getDirectoryPath());
    draftState.draftOpen = true;

    return new TextStreamDraft(this.#serialId, await this.#peekNextIndex(), {
      discard: () => {
        draftState.draftOpen = false;
      },
      finalize: async (startIndex, summary, sentences) =>
        await this.#commitDraft(startIndex, summary, sentences),
    });
  }

  public async getFragment(fragmentId: number): Promise<FragmentRecord> {
    const fragments = await this.#listFragments();
    const fragment = fragments.find((item) => item.fragmentId === fragmentId);

    if (fragment === undefined) {
      throw new Error(`Fragment ${fragmentId} does not exist`);
    }

    return fragment;
  }

  public async getSentence(sentenceIndex: number): Promise<SentenceRecord> {
    const location = await this.#getSentenceLocation(sentenceIndex);

    if (location === undefined) {
      throw new RangeError(`Sentence ${sentenceIndex} does not exist`);
    }

    return this.#readSentenceLocation(location, await this.#readContent());
  }

  public async listFragmentIds(): Promise<readonly number[]> {
    return (await this.#listFragments()).map((fragment) => fragment.fragmentId);
  }

  public async listSentences(): Promise<readonly SentenceRecord[]> {
    const rows = await this.#listSentenceLocations();
    const content = await this.#readContent();

    return rows.map((row) => this.#readSentenceLocation(row, content));
  }

  public async listSentencesInRange(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<readonly SentenceRecord[]> {
    if (endSentenceIndex < startSentenceIndex) {
      return [];
    }

    const rows = await this.#database.queryAll(
      `
        SELECT sentence_index, byte_offset, byte_length, words_count
        FROM text_sentence_records
        WHERE kind = ? AND chapter_id = ?
          AND sentence_index BETWEEN ? AND ?
        ORDER BY sentence_index
      `,
      [
        TEXT_STREAM_KIND[this.#stream],
        this.#serialId,
        startSentenceIndex,
        endSentenceIndex,
      ],
      mapTextSentenceLocation,
    );
    const content = await this.#readContent();

    return rows.map((row) => this.#readSentenceLocation(row, content));
  }

  async #getSentenceLocation(
    sentenceIndex: number,
  ): Promise<TextSentenceLocation | undefined> {
    return await this.#database.queryOne(
      `
        SELECT sentence_index, byte_offset, byte_length, words_count
        FROM text_sentence_records
        WHERE kind = ? AND chapter_id = ? AND sentence_index = ?
      `,
      [TEXT_STREAM_KIND[this.#stream], this.#serialId, sentenceIndex],
      mapTextSentenceLocation,
    );
  }

  async #listSentenceLocations(): Promise<readonly TextSentenceLocation[]> {
    return await this.#database.queryAll(
      `
        SELECT sentence_index, byte_offset, byte_length, words_count
        FROM text_sentence_records
        WHERE kind = ? AND chapter_id = ?
        ORDER BY sentence_index
      `,
      [TEXT_STREAM_KIND[this.#stream], this.#serialId],
      mapTextSentenceLocation,
    );
  }

  #readSentenceLocation(
    location: TextSentenceLocation,
    content: Buffer,
  ): SentenceRecord {
    return {
      text: content
        .subarray(
          location.byteOffset,
          location.byteOffset + location.byteLength,
        )
        .toString("utf8"),
      wordsCount: location.wordsCount,
    };
  }

  public async readText(): Promise<string | undefined> {
    const content = await this.#fileAccess.readFile(this.#getTextPath());

    return content === undefined
      ? undefined
      : Buffer.from(content).toString("utf8");
  }

  public async writeTextStream(text: string): Promise<void> {
    await this.delete();
    const sentences = splitTextIntoSentenceSpans(text);
    const draft = await this.createDraft();

    for (const sentence of sentences) {
      draft.addSentence(sentence.text, sentence.wordsCount, {
        byteOffset: sentence.byteOffset,
        byteLength: sentence.byteLength,
      });
    }

    await draft.commitWithText(text);
  }

  public async delete(): Promise<void> {
    await this.#fileAccess.deleteTree(this.#getTextPath());
    await this.#database.run(
      `
        DELETE FROM text_sentence_records
        WHERE kind = ? AND chapter_id = ?
      `,
      [TEXT_STREAM_KIND[this.#stream], this.#serialId],
    );
    delete this.#getDraftState().nextSentenceIndex;
  }

  public get path(): string {
    return this.#getTextPath();
  }

  public get serialId(): number {
    return this.#serialId;
  }

  async #commitDraft(
    startIndex: number,
    textOverride: string,
    sentences: readonly SentenceRecord[],
  ): Promise<FragmentRecord | undefined> {
    const draftState = this.#getDraftState();

    draftState.draftOpen = false;

    const existing = await this.#fileAccess.readFile(this.#getTextPath());
    const existingBuffer =
      existing === undefined ? Buffer.alloc(0) : Buffer.from(existing);
    const text =
      textOverride === ""
        ? sentences.map((sentence) => sentence.text).join("")
        : textOverride;
    const appendBuffer = Buffer.from(text, "utf8");
    let offset = existingBuffer.length;

    await this.#fileAccess.ensureDirectory(this.#getDirectoryPath());
    await this.#fileAccess.writeFile(
      this.#getTextPath(),
      Buffer.concat([existingBuffer, appendBuffer]),
      { overwrite: true },
    );

    if (sentences.length === 0) {
      return undefined;
    }

    for (let index = 0; index < sentences.length; index += 1) {
      const sentence = sentences[index];

      if (sentence === undefined) {
        continue;
      }

      const length = getSentenceByteLength(sentence);
      const explicitOffset = getSentenceByteOffset(sentence);
      const sentenceOffset = offset + explicitOffset;

      await this.#database.run(
        `
          INSERT OR REPLACE INTO text_sentence_records (
            kind,
            chapter_id,
            sentence_index,
            words_count,
            byte_offset,
            byte_length
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          TEXT_STREAM_KIND[this.#stream],
          this.#serialId,
          startIndex + index,
          sentence.wordsCount,
          sentenceOffset,
          length,
        ],
      );
      if (!hasSentenceByteOffset(sentence)) {
        offset += length;
      }
    }

    draftState.nextSentenceIndex = startIndex + sentences.length;

    return {
      fragmentId: startIndex,
      sentences,
      serialId: this.#serialId,
      summary: "",
    };
  }

  async #listFragments(): Promise<readonly FragmentRecord[]> {
    const sentences = await this.listSentences();
    const fragments: FragmentRecord[] = [];
    let current: SentenceRecord[] = [];
    let currentWords = 0;
    let fragmentStart = 0;

    for (let index = 0; index < sentences.length; index += 1) {
      const sentence = sentences[index];

      if (sentence === undefined) {
        continue;
      }
      if (
        current.length > 0 &&
        currentWords + sentence.wordsCount > DEFAULT_FRAGMENT_WORDS_COUNT
      ) {
        fragments.push({
          fragmentId: fragmentStart,
          sentences: current,
          serialId: this.#serialId,
          summary: "",
        });
        fragmentStart = index;
        current = [];
        currentWords = 0;
      }

      current.push(sentence);
      currentWords += sentence.wordsCount;
    }

    if (current.length > 0) {
      fragments.push({
        fragmentId: fragmentStart,
        sentences: current,
        serialId: this.#serialId,
        summary: "",
      });
    }

    return fragments;
  }

  async #peekNextIndex(): Promise<number> {
    const draftState = this.#getDraftState();

    if (draftState.nextSentenceIndex !== undefined) {
      return draftState.nextSentenceIndex;
    }

    draftState.nextSentenceIndex =
      (await this.#database.queryOne(
        `
          SELECT COALESCE(MAX(sentence_index), -1) + 1 AS next_index
          FROM text_sentence_records
          WHERE kind = ? AND chapter_id = ?
        `,
        [TEXT_STREAM_KIND[this.#stream], this.#serialId],
        (row) => Number(row.next_index),
      )) ?? 0;

    return draftState.nextSentenceIndex;
  }

  async #readContent(): Promise<Buffer> {
    const content = await this.#fileAccess.readFile(this.#getTextPath());

    return Buffer.from(content ?? new Uint8Array());
  }

  #getDirectoryPath(): string {
    return join(this.#documentPath, "texts", this.#stream);
  }

  #getTextPath(): string {
    return join(this.#getDirectoryPath(), `${this.#serialId}.txt`);
  }

  #getDraftState(): TextStreamDraftState {
    const key = `${this.#documentPath}\0${this.#stream}\0${this.#serialId}`;
    let state = SerialTextStream.#draftStates.get(key);

    if (state === undefined) {
      state = { draftOpen: false };
      SerialTextStream.#draftStates.set(key, state);
    }

    return state;
  }
}

function mapTextSentenceLocation(
  row: Record<string, unknown>,
): TextSentenceLocation {
  return {
    byteLength: Number(row.byte_length),
    byteOffset: Number(row.byte_offset),
    sentenceIndex: Number(row.sentence_index),
    wordsCount: Number(row.words_count),
  };
}

export class TextStreamDraft {
  #committed = false;
  readonly #discard: () => void;
  readonly #finalize: (
    startSentenceIndex: number,
    summary: string,
    sentences: readonly SentenceRecord[],
  ) => Promise<FragmentRecord | undefined>;
  readonly #sentences: SentenceRecord[] = [];
  readonly #serialId: number;
  readonly #startSentenceIndex: number;
  #summary = "";

  public constructor(
    serialId: number,
    startSentenceIndex: number,
    callbacks: {
      readonly discard: () => void;
      readonly finalize: (
        startSentenceIndex: number,
        summary: string,
        sentences: readonly SentenceRecord[],
      ) => Promise<FragmentRecord | undefined>;
    },
  ) {
    this.#discard = callbacks.discard;
    this.#finalize = callbacks.finalize;
    this.#serialId = serialId;
    this.#startSentenceIndex = startSentenceIndex;
  }

  public addSentence(
    text: string,
    wordsCount: number,
    location?: {
      readonly byteOffset: number;
      readonly byteLength: number;
    },
  ): SentenceId {
    this.#assertActive();
    const sentenceIndex = this.#startSentenceIndex + this.#sentences.length;

    this.#sentences.push({
      text,
      wordsCount,
      ...(location === undefined
        ? {}
        : {
            byteLength: location.byteLength,
            byteOffset: location.byteOffset,
          }),
    });

    return [this.#serialId, sentenceIndex];
  }

  public async commit(): Promise<FragmentRecord | undefined> {
    this.#assertActive();
    this.#committed = true;

    return await this.#finalize(
      this.#startSentenceIndex,
      this.#summary,
      this.#sentences,
    );
  }

  public async commitWithText(
    text: string,
  ): Promise<FragmentRecord | undefined> {
    this.#assertActive();
    this.#committed = true;

    return await this.#finalize(
      this.#startSentenceIndex,
      text,
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
    return this.#startSentenceIndex;
  }

  #assertActive(): void {
    if (this.#committed) {
      throw new Error("Text stream draft is already finalized");
    }
  }
}

function splitTextIntoSentenceSpans(text: string): ReadonlyArray<
  SentenceRecord & {
    readonly byteOffset: number;
    readonly byteLength: number;
  }
> {
  const spans: Array<
    SentenceRecord & {
      readonly byteOffset: number;
      readonly byteLength: number;
    }
  > = [];
  const pattern = /\S[^\n]*(?:\n(?!\n)\s*[^\n]+)*/gu;

  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const start = match.index;

    if (start === undefined) {
      continue;
    }

    const leadingWhitespaceLength = raw.length - raw.trimStart().length;
    const trailingWhitespaceLength = raw.length - raw.trimEnd().length;
    const sentenceStart = start + leadingWhitespaceLength;
    const sentenceEnd = start + raw.length - trailingWhitespaceLength;
    const sentence = text.slice(sentenceStart, sentenceEnd);

    if (sentence === "") {
      continue;
    }

    spans.push({
      byteLength: Buffer.byteLength(sentence, "utf8"),
      byteOffset: Buffer.byteLength(text.slice(0, sentenceStart), "utf8"),
      text: sentence,
      wordsCount: countWords(sentence),
    });
  }

  return spans;
}

function countWords(text: string): number {
  const trimmed = text.trim();

  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function getSentenceByteOffset(sentence: SentenceRecord): number {
  const value = (sentence as { readonly byteOffset?: unknown }).byteOffset;

  return typeof value === "number" ? value : 0;
}

function hasSentenceByteOffset(sentence: SentenceRecord): boolean {
  return (
    typeof (sentence as { readonly byteOffset?: unknown }).byteOffset ===
    "number"
  );
}

function getSentenceByteLength(sentence: SentenceRecord): number {
  const value = (sentence as { readonly byteLength?: unknown }).byteLength;

  return typeof value === "number"
    ? value
    : Buffer.byteLength(sentence.text, "utf8");
}
