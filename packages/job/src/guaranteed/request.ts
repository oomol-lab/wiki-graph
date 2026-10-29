import { requestGuaranteedJson as request } from "wiki-graph-runtime";
import type { JobLlmMessage } from "../ports.js";
import type { GuaranteedRequestOptions } from "./types.js";

export async function requestGuaranteedJson<TData, TResult>(
  options: GuaranteedRequestOptions<TData, TResult>,
): Promise<TResult> {
  return await request<TData, TResult, JobLlmMessage>(options);
}
