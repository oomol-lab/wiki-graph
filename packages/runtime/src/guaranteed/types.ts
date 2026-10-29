import type { QualityGate } from "../quality.js";
import type { RequestExecution } from "../candidate.js";
import type { ZodType } from "zod";

export interface RuntimeMessage {
  readonly content: string;
  readonly role: "assistant" | "system" | "user";
}
type JobLlmMessage = RuntimeMessage;

export type GuaranteedRequest = ((
  messages: readonly JobLlmMessage[],
  index: number,
  maxRetries: number,
  context?: RequestExecution,
) => Promise<string | undefined>) & { readonly quality?: QualityGate };

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

export interface GuaranteedRequestOptions<
  TData,
  TResult,
  TMessage = RuntimeMessage,
> {
  readonly maxRetries?: number;
  readonly signal?: AbortSignal;
  readonly deadline?: number;
  readonly timeoutMs?: number;
  readonly messages: readonly TMessage[];
  readonly parse: GuaranteedParser<TData, TResult>;
  readonly request: (
    messages: readonly (TMessage | RuntimeMessage)[],
    index: number,
    maxRetries: number,
    context?: RequestExecution,
  ) => Promise<string | undefined>;
  readonly responseIntentClassifierPrompt: string;
  readonly schema: ZodType<TData>;
}
