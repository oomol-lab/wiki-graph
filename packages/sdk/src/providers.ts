import type {
  LLMessage,
  LLMRequestOptions,
  LLMStreamProviderEvent,
  SearchIndexEmbeddingProvider,
  WikiGraphScope,
} from "wiki-graph-core";
import type { WikiGraphLLMConfig } from "./runtime-config.js";

export type WikiGraphLLMMessage = LLMessage;
export type WikiGraphLLMProviderEvent = LLMStreamProviderEvent;
export type WikiGraphLLMProviderOptions = LLMRequestOptions<WikiGraphScope>;

export interface WikiGraphLLMProvider {
  readonly identity?: string;
  readonly model: string;
  stream(
    messages: readonly WikiGraphLLMMessage[],
    options: WikiGraphLLMProviderOptions,
  ): AsyncIterable<WikiGraphLLMProviderEvent>;
}

export type WikiGraphEmbeddingProvider = SearchIndexEmbeddingProvider;

export interface WikiGraphSDKProviders {
  readonly embedding?: WikiGraphEmbeddingProvider;
  readonly llm?: WikiGraphLLMProvider;
}

export function resolveWikiGraphLLMJSON(options: {
  readonly llm?: WikiGraphLLMConfig;
  readonly llmJSON?: string;
}): string | undefined {
  if (options.llm !== undefined && options.llmJSON !== undefined) {
    throw new Error("Pass either llm or llmJSON, not both.");
  }
  return options.llm === undefined
    ? options.llmJSON
    : JSON.stringify(options.llm);
}
