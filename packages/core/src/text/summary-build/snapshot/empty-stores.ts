import type {
  MentionLinkRecord,
  MentionRecord,
  ReadonlyGraphBuildParameterStore,
  ReadonlyMentionLinkStore,
  ReadonlyMentionStore,
  ReadonlyObjectMetadataStore,
} from "../../../document/index.js";

export class EmptySnapshotMentionStore implements ReadonlyMentionStore {
  public getById(_mentionId: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public listAll(): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listByQid(_qid: string): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listBySurfaceTerms(
    _terms: readonly string[],
  ): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listBySurfaces(
    _surfaces: readonly string[],
  ): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }

  public listByChapter(_chapterId: number): Promise<MentionRecord[]> {
    return Promise.resolve([]);
  }
}

export class EmptySnapshotMentionLinkStore implements ReadonlyMentionLinkStore {
  public getById(_linkId: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  public listByTriple(_input: {
    readonly objectQid: string;
    readonly predicate: string;
    readonly subjectQid: string;
  }): Promise<MentionLinkRecord[]> {
    return Promise.resolve([]);
  }

  public listByChapter(_chapterId: number): Promise<MentionLinkRecord[]> {
    return Promise.resolve([]);
  }
}

export class EmptySnapshotObjectMetadataStore implements ReadonlyObjectMetadataStore {
  public getMap(
    _objectPath: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    return Promise.resolve({});
  }
}

export class EmptySnapshotGraphBuildParameterStore implements ReadonlyGraphBuildParameterStore {
  public getByHash(_hash: string): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}
