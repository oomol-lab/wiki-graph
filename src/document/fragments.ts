import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { join, resolve } from "path";

import { isNodeError } from "../utils/node-error.js";
import type { FragmentRecord, SentenceId, SentenceRecord } from "./types.js";

const SERIAL_DIRECTORY_PREFIX = "serial-";
const FRAGMENT_FILE_PATTERN = /^fragment_(\d+)\.json$/;

interface FragmentFileContent {
  readonly summary: string;
  readonly sentences: readonly SentenceRecord[];
}

interface FragmentWriter {
  write(path: string, content: string): Promise<void>;
}

const DEFAULT_FRAGMENT_WRITER: FragmentWriter = {
  write: async (path, content) => {
    await writeFile(path, content, "utf8");
  },
};

export interface ReadonlyFragments {
  getSerial(serialId: number): ReadonlySerialFragments;
  getSentence(sentenceId: SentenceId): Promise<string>;
  getSummary(serialId: number, fragmentId: number): Promise<string>;
  getWordsCount(serialId: number, fragmentId: number): Promise<number>;
  readonly path: string;
}

export interface ReadonlySerialFragments {
  getFragment(fragmentId: number): Promise<FragmentRecord>;
  listFragmentIds(): Promise<readonly number[]>;
  readonly serialId: number;
  readonly path: string;
}

export class Fragments implements ReadonlyFragments {
  readonly #documentPath: string;
  readonly #writer: FragmentWriter;

  public constructor(documentPath: string, writer?: FragmentWriter) {
    this.#documentPath = resolve(documentPath);
    this.#writer = writer ?? DEFAULT_FRAGMENT_WRITER;
  }

  public async ensureCreated(): Promise<void> {
    await mkdir(this.path, { recursive: true });
  }

  public getSerial(serialId: number): SerialFragments {
    return new SerialFragments(this.#documentPath, serialId, this.#writer);
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    const [serialId, fragmentId, sentenceIndex] = sentenceId;
    const fragment = await this.getSerial(serialId).getFragment(fragmentId);
    const sentence = fragment.sentences[sentenceIndex];

    if (sentence === undefined) {
      throw new RangeError(`Sentence ${sentenceIndex} does not exist`);
    }

    return sentence.text;
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
  #nextFragmentId: number | undefined;
  readonly #writer: FragmentWriter;

  public constructor(
    documentPath: string,
    serialId: number,
    writer?: FragmentWriter,
  ) {
    this.#documentPath = resolve(documentPath);
    this.#serialId = serialId;
    this.#writer = writer ?? DEFAULT_FRAGMENT_WRITER;
  }

  public async createDraft(): Promise<FragmentDraft> {
    if (this.#draftOpen) {
      throw new Error("Only one fragment draft can be open at a time");
    }

    await mkdir(this.path, { recursive: true });
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
    const fileContent = await readFragmentFile(
      this.#getFragmentPath(fragmentId),
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
      const entries = await readdir(this.path, { withFileTypes: true });

      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => FRAGMENT_FILE_PATTERN.exec(entry.name))
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

  public get serialId(): number {
    return this.#serialId;
  }

  public get path(): string {
    return join(
      this.#documentPath,
      "fragments",
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

    await mkdir(this.path, { recursive: true });
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

    return [this.#serialId, this.#fragmentId, sentenceIndex];
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
): Promise<FragmentFileContent> {
  const rawContent = JSON.parse(
    await readFile(fragmentPath, "utf8"),
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
