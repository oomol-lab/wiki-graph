import { requestGuaranteedJson as request } from "wiki-graph-runtime";
import type { LLMessage } from "../llm/index.js";
import type { GuaranteedRequestOptions } from "./types.js";

export async function requestGuaranteedJson<TData, TResult>(
  options: GuaranteedRequestOptions<TData, TResult>,
): Promise<TResult> {
  return await request<TData, TResult, LLMessage>(options);
}
