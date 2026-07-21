import type {
  ReadonlyDocument,
  ReadonlyGraphBuildParameterStore,
  ReadonlyMentionLinkStore,
  ReadonlyMentionStore,
  ReadonlyObjectMetadataStore,
  ReadonlySerialFragments,
  SentenceId,
} from "../../../document/index.js";
import type { SummaryInputSnapshotData } from "../types.js";
import { SnapshotChunkStore } from "./chunk-store.js";
import {
  EmptySnapshotGraphBuildParameterStore,
  EmptySnapshotMentionLinkStore,
  EmptySnapshotMentionStore,
  EmptySnapshotObjectMetadataStore,
} from "./empty-stores.js";
import {
  SnapshotFragmentGroupStore,
  SnapshotReadingEdgeStore,
  SnapshotSnakeChunkStore,
  SnapshotSnakeEdgeStore,
  SnapshotSnakeStore,
} from "./graph-stores.js";
import {
  SnapshotSerialFragments,
  SnapshotSerialStore,
} from "./serial-store.js";

export class SummaryInputSnapshotDocument implements ReadonlyDocument {
  public readonly chunks: SnapshotChunkStore;
  public readonly fragmentGroups: SnapshotFragmentGroupStore;
  public readonly graphBuildParameters: ReadonlyGraphBuildParameterStore;
  public readonly readingEdges: SnapshotReadingEdgeStore;
  public readonly mentionLinks: ReadonlyMentionLinkStore;
  public readonly mentions: ReadonlyMentionStore;
  public readonly metadata: ReadonlyObjectMetadataStore;
  public readonly serials: SnapshotSerialStore;
  public readonly snakeChunks: SnapshotSnakeChunkStore;
  public readonly snakeEdges: SnapshotSnakeEdgeStore;
  public readonly snakes: SnapshotSnakeStore;
  readonly #fragments: ReadonlySerialFragments;

  public constructor(snapshot: SummaryInputSnapshotData) {
    const serialId = snapshot.serial.id;

    this.chunks = new SnapshotChunkStore(snapshot.chunks, snapshot.fragments);
    this.fragmentGroups = new SnapshotFragmentGroupStore(
      snapshot.fragmentGroups,
    );
    this.graphBuildParameters = new EmptySnapshotGraphBuildParameterStore();
    this.readingEdges = new SnapshotReadingEdgeStore(
      snapshot.readingEdges,
      snapshot.chunks,
    );
    this.mentionLinks = new EmptySnapshotMentionLinkStore();
    this.mentions = new EmptySnapshotMentionStore();
    this.metadata = new EmptySnapshotObjectMetadataStore();
    this.serials = new SnapshotSerialStore(snapshot.serial);
    this.snakeChunks = new SnapshotSnakeChunkStore(snapshot.snakeChunks);
    this.snakeEdges = new SnapshotSnakeEdgeStore(
      snapshot.snakeEdges,
      snapshot.snakes,
    );
    this.snakes = new SnapshotSnakeStore(snapshot.snakes);
    this.#fragments = new SnapshotSerialFragments(serialId, snapshot.fragments);
  }

  public async getSentence(sentenceId: SentenceId): Promise<string> {
    const [serialId, sentenceIndex] = sentenceId;
    const sentence = (await this.getSerialFragments(serialId).listSentences!())[
      sentenceIndex
    ];

    if (sentence === undefined) {
      throw new RangeError(`Sentence ${sentenceIndex} does not exist`);
    }

    return sentence.text;
  }

  public getSerialFragments(serialId: number): ReadonlySerialFragments {
    if (serialId !== this.#fragments.serialId) {
      return new SnapshotSerialFragments(serialId, []);
    }
    return this.#fragments;
  }

  public getSummaryFragments(serialId: number): ReadonlySerialFragments {
    return new SnapshotSerialFragments(serialId, []);
  }

  public async openSession<T>(
    operation: (document: ReadonlyDocument) => Promise<T> | T,
  ): Promise<T> {
    return await operation(this);
  }

  public readDatabase<T>(): Promise<T> {
    return Promise.reject(
      new Error("Summary input snapshots do not expose a SQLite database."),
    );
  }

  public readSearchIndexDatabase<T>(): Promise<T> {
    return Promise.reject(
      new Error(
        "Summary input snapshots do not expose a search index database.",
      ),
    );
  }

  public readBookMeta(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public readCover(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public readSummary(_serialId: number): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public readToc(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public release(): Promise<void> {
    return Promise.resolve();
  }
}
