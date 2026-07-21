import type {
  FragmentRecord,
  ReadonlySerialFragments,
  ReadonlySerialStore,
  SerialRecord,
} from "../../../document/index.js";
import { compareNumber } from "./helpers.js";

export class SnapshotSerialStore implements ReadonlySerialStore {
  readonly #serial: SerialRecord;

  public constructor(serial: SerialRecord) {
    this.#serial = serial;
  }

  public getById(serialId: number): Promise<SerialRecord | undefined> {
    return Promise.resolve(
      serialId === this.#serial.id ? this.#serial : undefined,
    );
  }

  public getRevision(serialId: number): Promise<number> {
    return Promise.resolve(
      serialId === this.#serial.id ? this.#serial.revision : 0,
    );
  }

  public getRevisions(
    serialIds: readonly number[],
  ): Promise<ReadonlyMap<number, number>> {
    return Promise.resolve(
      new Map(
        serialIds
          .filter((serialId) => serialId === this.#serial.id)
          .map((serialId) => [serialId, this.#serial.revision] as const),
      ),
    );
  }

  public getChaptersRevision(): Promise<number> {
    return Promise.resolve(this.#serial.revision);
  }

  public getMaxId(): Promise<number> {
    return Promise.resolve(this.#serial.id);
  }

  public listIds(): Promise<number[]> {
    return Promise.resolve([this.#serial.id]);
  }

  public listDocumentOrders(): Promise<ReadonlyMap<number, number>> {
    return Promise.resolve(
      new Map([[this.#serial.id, this.#serial.documentOrder]]),
    );
  }
}

export class SnapshotSerialFragments implements ReadonlySerialFragments {
  public readonly path = "";
  public readonly serialId: number;
  readonly #fragmentsById: Map<number, FragmentRecord>;

  public constructor(serialId: number, fragments: readonly FragmentRecord[]) {
    this.serialId = serialId;
    this.#fragmentsById = new Map(
      fragments
        .filter((fragment) => fragment.serialId === serialId)
        .map((fragment) => [fragment.fragmentId, fragment]),
    );
  }

  public getFragment(fragmentId: number): Promise<FragmentRecord> {
    const fragment = this.#fragmentsById.get(fragmentId);

    if (fragment === undefined) {
      throw new Error(`Fragment ${fragmentId} does not exist`);
    }

    return Promise.resolve(fragment);
  }

  public listFragmentIds(): Promise<readonly number[]> {
    return Promise.resolve([...this.#fragmentsById.keys()].sort(compareNumber));
  }

  public async getSentence(sentenceIndex: number) {
    const sentence = (await this.listSentences())[sentenceIndex];

    if (sentence === undefined) {
      throw new RangeError(`Sentence ${sentenceIndex} does not exist`);
    }

    return sentence;
  }

  public async listSentencesInRange(
    startSentenceIndex: number,
    endSentenceIndex: number,
  ) {
    return (await this.listSentences()).slice(
      startSentenceIndex,
      endSentenceIndex + 1,
    );
  }

  public async listSentences() {
    const fragments = await Promise.all(
      (await this.listFragmentIds()).map(
        async (fragmentId) => await this.getFragment(fragmentId),
      ),
    );

    return fragments.flatMap((fragment) => fragment.sentences);
  }

  public async readText(): Promise<string | undefined> {
    const sentences = await this.listSentences();

    if (sentences.length === 0) {
      return undefined;
    }

    return sentences.map((sentence) => sentence.text).join("");
  }
}
