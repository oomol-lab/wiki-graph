import type { LLMessage } from "../llm/index.js";
import type { ZodType } from "zod";

export type GuaranteedRequest = (
  messages: readonly LLMessage[],
  index: number,
  maxRetries: number,
) => Promise<string | undefined>;

export type GuaranteedLazyRequest = <T>(
  operation: (request: GuaranteedRequest) => Promise<T>,
) => Promise<T>;

export type GuaranteedRequestController = GuaranteedRequest & {
  lazy?: GuaranteedLazyRequest;
};

export type GuaranteedParser<TData, TResult> = (
  data: TData,
  index: number,
  maxRetries: number,
) => TResult | Promise<TResult>;

export interface GuaranteedRequestOptions<TData, TResult> {
  readonly responseIntentClassifierPrompt: string;
  readonly schema: ZodType<TData>;
  readonly request: GuaranteedRequest;
  readonly messages: readonly LLMessage[];
  readonly parse: GuaranteedParser<TData, TResult>;
  readonly maxRetries?: number;
}
