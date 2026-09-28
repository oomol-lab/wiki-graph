import type { ZodType } from "zod";

import type { JobLlmMessage } from "../ports.js";

export type GuaranteedRequest = (
  messages: readonly JobLlmMessage[],
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
  readonly maxRetries?: number;
  readonly messages: readonly JobLlmMessage[];
  readonly parse: GuaranteedParser<TData, TResult>;
  readonly request: GuaranteedRequest;
  readonly responseIntentClassifierPrompt: string;
  readonly schema: ZodType<TData>;
}
