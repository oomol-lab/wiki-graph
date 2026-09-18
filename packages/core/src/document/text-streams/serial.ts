import type { Database } from "../database.js";
import { joinDocumentPath, resolveDocumentPath } from "../directory/path.js";
import {
  Sentence,
  type FragmentRecord,
  type SentenceRecord,
} from "../types.js";
import { TextStreamDraft } from "./draft.js";
import {
  getSentenceByteLength,
  getSentenceByteOffset,
  getSentenceRawText,
  hasSentenceByteOffset,
  splitTextIntoSentenceSpans,
} from "./sentence.js";
import {
  DEFAULT_FRAGMENT_WORDS_COUNT,
  TEXT_STREAM_KIND,
  type ReadonlySerialTextStream,
  type TextSentenceLocation,
  type TextStreamRangeRead,
  type TextStreamDraftState,
  type TextStreamFileAccess,
  type TextStreamName,
  type WriteTextStreamOptions,
} from "./types.js";

export class SerialTextStream implements ReadonlySerialTextStream {
  static readonly #draftStates = new Map<string, TextStreamDraftState>();

  readonly #database: Database;
  readonly #documentPath: string;
  readonly #fileAccess: TextStreamFileAccess;
  readonly #stream: TextStreamName;
  readonly #serialId: number;
  readonly #identity: string;

  public constructor(
    documentPath: string,
    database: Database,
    fileAccess: TextStreamFileAccess,
    stream: TextStreamName,
    serialId: number,
    identity = documentPath,
  ) {
    this.#database = database;
    this.#documentPath = resolveDocumentPath(documentPath);
    this.#fileAccess = fileAccess;
    this.#stream = stream;
    this.#serialId = serialId;
    this.#identity = identity;
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

    return this.#readSentenceLocation(
      location,
      await this.#readContentRange(location.byteOffset, location.byteLength),
      location.byteOffset,
    );
  }

  public async listFragmentIds(): Promise<readonly number[]> {
    return (await this.#listFragments()).map((fragment) => fragment.fragmentId);
  }

  public async listSentences(): Promise<readonly SentenceRecord[]> {
    const rows = await this.#listSentenceLocations();
    const first = rows[0];
    const last = rows.at(-1);
    if (first === undefined || last === undefined) return [];
    const content = await this.#readContentRange(
      first.byteOffset,
      last.byteOffset + last.byteLength - first.byteOffset,
    );
    return rows.map((row) =>
      this.#readSentenceLocation(row, content, first.byteOffset),
    );
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

  public async readTextInRange(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<string | undefined> {
    return (
      await this.readTextInRangeWithOffsets(
        startSentenceIndex,
        endSentenceIndex,
      )
    )?.text;
  }

  public async readTextInRangeWithOffsets(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ): Promise<TextStreamRangeRead | undefined> {
    if (endSentenceIndex < startSentenceIndex) {
      return { sourceEnd: 0, sourceStart: 0, text: "" };
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
    const first = rows[0];
    const last = rows[rows.length - 1];

    if (first === undefined || last === undefined) {
      return undefined;
    }

    const content = await this.#readContentRange(
      first.byteOffset,
      last.byteOffset + last.byteLength - first.byteOffset,
    );
    const text = new TextDecoder().decode(content);
    const sourceStart = await this.#countCharactersBefore(first.byteOffset);

    return {
      sourceEnd: sourceStart + Array.from(text).length,
      sourceStart,
      text,
    };
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
    content: Uint8Array,
    contentOffset = 0,
  ): SentenceRecord {
    return new Sentence(
      new TextDecoder().decode(
        content.subarray(
          location.byteOffset - contentOffset,
          location.byteOffset - contentOffset + location.byteLength,
        ),
      ),
      location.wordsCount,
    );
  }

  public async readText(): Promise<string | undefined> {
    const content = await this.#fileAccess.readFile(this.#getTextPath());

    return content === undefined
      ? undefined
      : new TextDecoder().decode(content);
  }

  public async writeTextStream(
    text: string,
    options: WriteTextStreamOptions = {},
  ): Promise<void> {
    await this.delete();
    const sentences = await splitTextIntoSentenceSpans(text, options.segmenter);
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

    const text =
      textOverride === ""
        ? sentences.map(getSentenceRawText).join("")
        : textOverride;
    const appendBuffer = new TextEncoder().encode(text);
    let offset = await this.#fileSize();

    await this.#fileAccess.ensureDirectory(this.#getDirectoryPath());
    if (this.#fileAccess.appendFile !== undefined) {
      await this.#fileAccess.appendFile(this.#getTextPath(), appendBuffer);
    } else {
      const existing = await this.#fileAccess.readFile(this.#getTextPath());
      await this.#fileAccess.writeFile(
        this.#getTextPath(),
        concatenateBytes(existing ?? new Uint8Array(), appendBuffer),
        { overwrite: true },
      );
    }

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

  async #readContent(): Promise<Uint8Array> {
    const content = await this.#fileAccess.readFile(this.#getTextPath());

    return content ?? new Uint8Array();
  }

  async #fileSize(): Promise<number> {
    if (this.#fileAccess.getFileSize !== undefined) {
      return (await this.#fileAccess.getFileSize(this.#getTextPath())) ?? 0;
    }
    const content = await this.#fileAccess.readFile(this.#getTextPath());
    return content?.byteLength ?? 0;
  }

  async #readContentRange(offset: number, length: number): Promise<Uint8Array> {
    const content =
      this.#fileAccess.readFileRange === undefined
        ? await this.#readContent()
        : await this.#fileAccess.readFileRange(
            this.#getTextPath(),
            offset,
            length,
          );
    if (content === undefined) return new Uint8Array();
    if (this.#fileAccess.readFileRange === undefined) {
      return content.subarray(offset, offset + length);
    }
    return content;
  }

  async #countCharactersBefore(byteOffset: number): Promise<number> {
    if (byteOffset === 0) return 0;
    if (this.#fileAccess.readFileRange === undefined) {
      const content = await this.#readContent();
      return Array.from(
        new TextDecoder().decode(content.subarray(0, byteOffset)),
      ).length;
    }
    let count = 0;
    let offset = 0;
    const decoder = new TextDecoder();
    while (offset < byteOffset) {
      const length = Math.min(64 * 1024, byteOffset - offset);
      const chunk = await this.#fileAccess.readFileRange(
        this.#getTextPath(),
        offset,
        length,
      );
      if (chunk === undefined) break;
      if (chunk.byteLength === 0) break;
      count += Array.from(
        decoder.decode(chunk, { stream: offset + length < byteOffset }),
      ).length;
      offset += chunk.byteLength;
    }
    count += Array.from(decoder.decode()).length;
    return count;
  }

  #getDirectoryPath(): string {
    return joinDocumentPath(this.#documentPath, "texts", this.#stream);
  }

  #getTextPath(): string {
    return joinDocumentPath(this.#getDirectoryPath(), `${this.#serialId}.txt`);
  }

  #getDraftState(): TextStreamDraftState {
    const key = `${this.#identity}\0${this.#stream}\0${this.#serialId}`;
    let state = SerialTextStream.#draftStates.get(key);

    if (state === undefined) {
      state = { draftOpen: false };
      SerialTextStream.#draftStates.set(key, state);
    }

    return state;
  }
}

function concatenateBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
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
