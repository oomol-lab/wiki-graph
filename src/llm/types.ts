import type { LanguageModel, ModelMessage } from "ai";

export type LLMessage = ModelMessage;
export type LLMModel = LanguageModel;

export type TemperatureSetting = number | readonly number[];

export interface SamplingProfile {
  readonly temperature?: TemperatureSetting;
  readonly topP?: TemperatureSetting;
}

export type SamplingScopeConfig<S extends string> = {
  readonly [scope in S]: SamplingProfile;
};

export interface LLMRequestOptions<S extends string> {
  readonly signal?: AbortSignal;
  readonly temperature?: TemperatureSetting;
  readonly topP?: TemperatureSetting;
  readonly scope?: S;
  readonly useCache?: boolean;
  readonly retryIndex?: number;
  readonly retryMax?: number;
}

export type LLMRequestFunction<S extends string> = (
  messages: readonly LLMessage[],
  options?: LLMRequestOptions<S>,
) => Promise<string>;

export type LLMLazyRequestOperation<S extends string, T> = (
  request: LLMRequestFunction<S>,
) => Promise<T>;

export type LLMStreamProgressCallback = (event: {
  readonly outputCharacters: number;
}) => void | Promise<void>;

export interface LLMTokenUsage {
  readonly cacheReadTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export type LLMTokenUsageCallback = (
  usage: LLMTokenUsage,
) => void | Promise<void>;

export interface LLMOptions<S extends string> {
  readonly model: LLMModel;
  readonly dataDirPath: string;
  readonly logDirPath?: string;
  readonly cacheDirPath?: string;
  readonly concurrent?: number;
  readonly stream?: boolean;
  readonly timeout?: number;
  readonly temperature?: TemperatureSetting;
  readonly topP?: TemperatureSetting;
  readonly sampling?: SamplingScopeConfig<S>;
  readonly retryTimes?: number;
  readonly retryIntervalSeconds?: number;
  readonly onStreamProgress?: LLMStreamProgressCallback;
  readonly onTokenUsage?: LLMTokenUsageCallback;
}
