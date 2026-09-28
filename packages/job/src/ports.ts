import type { JobDirectory } from "./platform.js";

export interface JobLlmMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}

export interface JobLlmUsage {
  readonly cacheReadTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface JobLlm {
  request(
    messages: readonly JobLlmMessage[],
    options: {
      readonly retryIndex?: number;
      readonly retryMax?: number;
      readonly scope: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<string>;
}

export interface JobEmbeddingProvider {
  readonly dimensions?: number;
  readonly identity?: string;
  readonly model: string;
  embedTexts(
    texts: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<{ readonly embeddings: readonly (readonly number[])[] }>;
}

export interface JobWikispineQidOption {
  readonly disambiguation: boolean;
  readonly qid: string;
}

export interface JobWikispineMatch {
  readonly end: number;
  readonly qids: readonly JobWikispineQidOption[];
  readonly start: number;
}

export interface JobWikispineMatcher {
  match(input: {
    readonly includeDisambiguation: boolean;
    readonly onProgress?: (input: {
      readonly coveredRangeEnd: number;
    }) => Promise<void> | void;
    readonly sentences: readonly {
      readonly id: string;
      readonly range: { readonly end: number; readonly start: number };
      readonly text: string;
    }[];
  }): Promise<readonly JobWikispineMatch[]>;
}

export interface JobWikimediaLanguageProfile {
  readonly description: string | null;
  readonly label: string | null;
  readonly url: string | null;
}

export interface JobWikimediaResolution {
  readonly disambiguation?: readonly {
    readonly information: string;
    readonly qid: string;
  }[];
  readonly en: JobWikimediaLanguageProfile;
  readonly qid: string;
  readonly zh: JobWikimediaLanguageProfile;
}

export interface JobWikimediaResolver {
  resolve(
    input: readonly {
      readonly disambiguation: boolean;
      readonly qid: string;
    }[],
  ): Promise<readonly JobWikimediaResolution[]>;
}

export type JobProgressPhase =
  | "committing"
  | "enrichment"
  | "grounding"
  | "indexing"
  | "matching"
  | "narrowing"
  | "relation-discovery"
  | "screening";

export interface JobProgressSink {
  addOutputCharacters?(characters: number): Promise<void> | void;
  addTokenUsage?(usage: JobLlmUsage): Promise<void> | void;
  throwIfStopped?(): Promise<void> | void;
  updatePhase?(input: {
    readonly done: number;
    readonly force?: boolean;
    readonly phase: JobProgressPhase;
    readonly phaseDetail?: string;
    readonly total: number;
    readonly unit:
      | "candidate"
      | "char"
      | "item"
      | "page"
      | "qid"
      | "record"
      | "sentence"
      | "window";
  }): Promise<void> | void;
}

export interface JobExecutionContext {
  readonly progress?: JobProgressSink;
  readonly signal?: AbortSignal;
  readonly workspace: JobDirectory;
}
